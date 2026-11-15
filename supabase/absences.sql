-- NiKo: "Kind bleibt zuhause". Nach schema.sql und push.sql ausführen.

create table if not exists niko_children (
  id text primary key,
  name text not null,
  family text not null check (family in ('a', 'b')),
  sort int not null default 0
);

insert into niko_children (id, name, family, sort) values
  ('ni', 'Ni', 'a', 1),
  ('ko', 'Ko', 'b', 2)
on conflict (id) do nothing;

create table if not exists niko_absences (
  day date not null,
  child_id text not null references niko_children (id) on delete cascade,
  created_by text references niko_people (id),
  created_at timestamptz not null default now(),
  primary key (day, child_id)
);

alter table niko_children enable row level security;
alter table niko_absences enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on niko_children, niko_absences from %I', r);
    end if;
  end loop;
end $$;

-- Laden: wie bisher, dazu Kinder und Abwesenheiten.
create or replace function niko_load(p_token text, p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_me text := niko_who(p_token);
begin
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'niko: Zeitraum ungültig';
  end if;
  return jsonb_build_object(
    'me', v_me,
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'family', family,
        'handover_time', to_char(handover_time, 'FMHH24:MI'),
        'handover_place', handover_place) order by sort, name), '[]'::jsonb)
      from niko_people),
    'children', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'family', family) order by sort), '[]'::jsonb)
      from niko_children),
    'standard', (select coalesce(jsonb_agg(jsonb_build_object(
        'parity', parity, 'weekday', weekday, 'kind', kind, 'status', status,
        'person_id', person_id, 'detail', detail)), '[]'::jsonb)
      from niko_standard),
    'slots', (select coalesce(jsonb_agg(jsonb_build_object(
        'day', day, 'kind', kind, 'status', status, 'person_id', person_id,
        'asked_by', asked_by, 'request_id', request_id, 'updated_by', updated_by)), '[]'::jsonb)
      from niko_slots where day between p_from and p_to),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'body', body)), '[]'::jsonb)
      from niko_notes where day between p_from and p_to),
    'notices', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'day', day, 'title', title, 'body', body,
        'bring_by', to_char(bring_by, 'FMHH24:MI')) order by created_at), '[]'::jsonb)
      from niko_notices where day between p_from and p_to),
    'absences', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'child_id', child_id, 'created_by', created_by)), '[]'::jsonb)
      from niko_absences where day between p_from and p_to)
  );
end $$;

-- Kind an einem Tag abmelden oder wieder anmelden.
create or replace function niko_set_absence(p_token text, p_day date, p_child text, p_absent boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_name text;
  v_today date := (now() at time zone 'Europe/Vienna')::date;
  v_when text;
  v_count int;
begin
  select name into v_name from niko_children where id = p_child;
  if v_name is null then raise exception 'niko: Kind unbekannt'; end if;
  if extract(isodow from p_day) > 5 then raise exception 'niko: nur Montag bis Freitag'; end if;
  if p_absent then
    insert into niko_absences (day, child_id, created_by) values (p_day, p_child, v_me)
    on conflict (day, child_id) do nothing;
  else
    delete from niko_absences where day = p_day and child_id = p_child;
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 or p_day < v_today then return; end if;
  v_when := case
    when p_day = v_today then 'heute'
    when p_day = v_today + 1 then 'morgen'
    else 'am ' || (array['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])[extract(isodow from p_day)::int] || ' ' || to_char(p_day, 'FMDD.FMMM.')
  end;
  perform niko_push(niko_others(v_me),
    case when p_absent then v_name || ' bleibt ' || v_when || ' zuhause' else v_name || ' kommt ' || v_when || ' doch' end,
    case when p_absent then 'Eingetragen von ' || niko_name(v_me) || '.' else niko_name(v_me) || ' hat die Abmeldung zurückgenommen.' end,
    '', 'absence-' || p_day || '-' || p_child);
end $$;

-- Erinnerung am Morgen: wie bisher, mit Hinweis auf Kinder, die zuhause bleiben.
create or replace function niko_morning(p_now timestamp default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamp := coalesce(p_now, now() at time zone 'Europe/Vienna');
  v_today date := v_now::date;
  v_bring record;
  v_pick record;
  v_p niko_people;
  v_parts text[];
  v_by text;
  v_open text[] := '{}';
  v_home text;
  v_home_count int;
  v_all int;
begin
  if extract(isodow from v_today) > 5 or extract(hour from v_now) <> 7 then return; end if;
  if exists (select 1 from niko_config where key = 'morning_last' and value = v_today::text) then return; end if;
  insert into niko_config (key, value) values ('morning_last', v_today::text)
    on conflict (key) do update set value = excluded.value;

  select count(*) into v_all from niko_children;
  select count(*), string_agg(c.name, ' und ' order by c.sort) into v_home_count, v_home
    from niko_absences a join niko_children c on c.id = a.child_id where a.day = v_today;
  -- Bleiben alle Kinder zuhause, gibt es nichts zu erinnern.
  if v_all > 0 and v_home_count >= v_all then return; end if;

  select * into v_bring from niko_resolve(v_today, 'bring');
  select * into v_pick from niko_resolve(v_today, 'pick');
  select to_char(min(bring_by), 'FMHH24:MI') || ' (' || string_agg(title, ', ') || ')'
    into v_by from niko_notices where day = v_today and bring_by is not null;

  for v_p in select * from niko_people loop
    v_parts := '{}';
    if v_bring.status = 'person' and v_bring.person_id = v_p.id then
      v_parts := v_parts || ('Du bringst'
        || coalesce(', Übergabe ' || to_char(v_p.handover_time, 'FMHH24:MI') || coalesce(', ' || v_p.handover_place, ''), '')
        || coalesce('. Heute bis ' || v_by || ' im Kindergarten', '') || '.');
    end if;
    if v_pick.status = 'person' and v_pick.person_id = v_p.id then
      v_parts := v_parts || ('Du holst ab' || coalesce('. ' || v_pick.detail, '') || '.');
    end if;
    if array_length(v_parts, 1) > 0 then
      if v_home is not null then v_parts := v_parts || (v_home || ' bleibt heute zuhause.'); end if;
      perform niko_push(array[v_p.id], 'Heute bist du dran', array_to_string(v_parts, ' '), '', 'morning');
    end if;
  end loop;

  if v_bring.status in ('open', 'asked') then v_open := v_open || 'Bringen'::text; end if;
  if v_pick.status in ('open', 'asked') then v_open := v_open || 'Abholen'::text; end if;
  if array_length(v_open, 1) > 0 then
    perform niko_push(null, 'Heute noch offen',
      array_to_string(v_open, ' und ') || ' ist noch nicht vergeben. Wer kann?', '', 'morning-open');
  end if;
end $$;

-- Tag ändern: keine Benachrichtigung mehr, wenn nur auf den Standardplan zurückgesetzt wird.
create or replace function niko_set_slot(p_token text, p_day date, p_kind text, p_status text, p_person text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_before record;
  v_after record;
begin
  if p_kind not in ('bring', 'pick') then raise exception 'niko: Art ungültig'; end if;
  if extract(isodow from p_day) > 5 then raise exception 'niko: nur Montag bis Freitag'; end if;
  select * into v_before from niko_resolve(p_day, p_kind);
  if p_status = 'reset' then
    delete from niko_slots where day = p_day and kind = p_kind;
  else
    if p_status not in ('person', 'separate', 'open') then raise exception 'niko: Status ungültig'; end if;
    insert into niko_slots (day, kind, status, person_id, asked_by, request_id, updated_by, updated_at)
    values (p_day, p_kind, p_status, case when p_status = 'person' then p_person end, null, null, v_me, now())
    on conflict (day, kind) do update
      set status = excluded.status, person_id = excluded.person_id, asked_by = null,
          request_id = null, updated_by = v_me, updated_at = now();
  end if;
  select * into v_after from niko_resolve(p_day, p_kind);
  if p_day < (now() at time zone 'Europe/Vienna')::date then return; end if;
  -- Tag ist neu offen: alle anderen erfahren es.
  if v_after.status = 'open' and v_before.status not in ('open', 'asked') then
    perform niko_push(niko_others(v_me), 'Noch offen',
      niko_label(p_day, p_kind) || ' ist jetzt offen. Wer kann?', '', 'slot-' || p_day || '-' || p_kind);
  end if;
  -- Jemand wurde von einer anderen Person eingetragen.
  if p_status <> 'reset' and v_after.status = 'person' and v_after.person_id <> v_me
     and v_after.person_id is distinct from v_before.person_id then
    perform niko_push(array[v_after.person_id], 'Du bist eingetragen',
      niko_name(v_me) || ' hat dich eingetragen: ' || niko_label(p_day, p_kind) || '.', '', 'slot-' || p_day || '-' || p_kind);
  end if;
end $$;

revoke all on function niko_set_absence(text, date, text, boolean) from public;
revoke all on function niko_morning(timestamp) from public;
revoke all on function niko_load(text, date, date) from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function niko_set_absence(text, date, text, boolean) to %I', r);
      execute format('grant execute on function niko_load(text, date, date) to %I', r);
      execute format('revoke all on function niko_morning(timestamp) from %I', r);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
