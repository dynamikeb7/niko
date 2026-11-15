-- NiKo: Push-Benachrichtigungen. Nach schema.sql ausführen.
-- Braucht die Erweiterungen pg_net (Versand) und pg_cron (Erinnerung am Morgen).

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then raise warning 'niko: pg_net nicht verfügbar (%)', sqlerrm;
end $$;

do $$ begin
  create extension if not exists pg_cron;
exception when others then raise warning 'niko: pg_cron nicht verfügbar (%)', sqlerrm;
end $$;

-- Interne Einstellungen: Adresse der Versand-Funktion, gemeinsames Geheimnis, Adresse der App.
create table if not exists niko_config (
  key text primary key,
  value text not null
);

create table if not exists niko_push_subs (
  endpoint text primary key,
  person_id text not null references niko_people (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table niko_config enable row level security;
alter table niko_push_subs enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on niko_config, niko_push_subs from %I', r);
    end if;
  end loop;
end $$;

-- "Do 19.11., Bringen"
create or replace function niko_label(p_day date, p_kind text)
returns text
language sql
immutable
as $$
  select (array['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])[extract(isodow from p_day)::int]
    || ' ' || to_char(p_day, 'FMDD.FMMM.') || ', '
    || case p_kind when 'bring' then 'Bringen' else 'Abholen' end;
$$;

-- Wer macht es an diesem Tag? Standardplan plus Änderungen.
create or replace function niko_resolve(p_day date, p_kind text, out status text, out person_id text, out detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parity text := case when extract(week from p_day)::int % 2 = 0 then 'even' else 'odd' end;
  v_std niko_standard;
  v_slot niko_slots;
begin
  select * into v_std from niko_standard s
    where s.parity = v_parity and s.weekday = extract(isodow from p_day)::int - 1 and s.kind = p_kind;
  select * into v_slot from niko_slots s where s.day = p_day and s.kind = p_kind;
  if v_slot.day is not null then
    status := v_slot.status;
    person_id := v_slot.person_id;
  elsif v_std.parity is not null then
    status := v_std.status;
    person_id := v_std.person_id;
  else
    status := 'open';
  end if;
  detail := v_std.detail;
end $$;

-- Benachrichtigung an Personen schicken. p_to = null heißt an alle.
-- Fehler beim Versand dürfen die eigentliche Änderung nie verhindern.
create or replace function niko_push(p_to text[], p_title text, p_body text, p_path text, p_tag text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_site text;
  v_subs jsonb;
begin
  select value into v_url from niko_config where key = 'push_url';
  select value into v_secret from niko_config where key = 'push_secret';
  select value into v_site from niko_config where key = 'site_url';
  if v_url is null or v_secret is null then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'keys', jsonb_build_object('p256dh', p256dh, 'auth', auth)))
    into v_subs
    from niko_push_subs
    where p_to is null or person_id = any (p_to);
  if v_subs is null then return; end if;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object(
      'secret', v_secret,
      'subscriptions', v_subs,
      'notification', jsonb_build_object(
        'title', p_title, 'body', p_body, 'tag', p_tag,
        'url', coalesce(v_site, '') || coalesce(p_path, ''))),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 8000);
exception when others then
  raise warning 'niko: Push nicht verschickt (%)', sqlerrm;
end $$;

create or replace function niko_others(p_me text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$ select coalesce(array_agg(id), '{}') from niko_people where id <> p_me $$;

create or replace function niko_name(p_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select name from niko_people where id = p_id), 'Jemand') $$;

-- ---------- Abo verwalten ----------

create or replace function niko_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me text := niko_who(p_token);
begin
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 then raise exception 'niko: Adresse ungültig'; end if;
  insert into niko_push_subs (endpoint, person_id, p256dh, auth)
  values (p_endpoint, v_me, p_p256dh, p_auth)
  on conflict (endpoint) do update set person_id = v_me, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function niko_push_unsubscribe(p_token text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform niko_who(p_token);
  delete from niko_push_subs where endpoint = p_endpoint;
end $$;

-- Die Versand-Funktion meldet hier Abos, die es nicht mehr gibt.
create or replace function niko_push_gone(p_secret text, p_endpoints text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is distinct from (select value from niko_config where key = 'push_secret') then
    raise exception 'niko: nicht erlaubt';
  end if;
  delete from niko_push_subs where endpoint = any (p_endpoints);
end $$;

-- ---------- Bestehende Funktionen mit Benachrichtigung ----------

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

create or replace function niko_ask(p_token text, p_day date, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_req uuid := gen_random_uuid();
  v_detail text;
begin
  if p_kind not in ('bring', 'pick') then raise exception 'niko: Art ungültig'; end if;
  if extract(isodow from p_day) > 5 then raise exception 'niko: nur Montag bis Freitag'; end if;
  insert into niko_slots (day, kind, status, person_id, asked_by, request_id, updated_by, updated_at)
  values (p_day, p_kind, 'asked', null, v_me, v_req, v_me, now())
  on conflict (day, kind) do update
    set status = 'asked', person_id = null, asked_by = v_me, request_id = v_req,
        updated_by = v_me, updated_at = now();
  select detail into v_detail from niko_resolve(p_day, p_kind);
  perform niko_push(niko_others(v_me), 'Ersatz gesucht',
    niko_name(v_me) || ' sucht Ersatz: ' || niko_label(p_day, p_kind) || '.'
      || coalesce(' ' || v_detail || '.', '') || ' Tippen zum Übernehmen.',
    '?anfrage=' || v_req, 'slot-' || p_day || '-' || p_kind);
  return v_req;
end $$;

create or replace function niko_accept(p_token text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_slot niko_slots;
begin
  select * into v_slot from niko_slots where request_id = p_request for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'gone');
  end if;
  if v_slot.status <> 'asked' then
    return jsonb_build_object('ok', false, 'reason', 'taken', 'person_id', v_slot.person_id, 'status', v_slot.status);
  end if;
  update niko_slots
    set status = 'person', person_id = v_me, updated_by = v_me, updated_at = now()
    where day = v_slot.day and kind = v_slot.kind;
  perform niko_push(array_remove(niko_others(v_me), null), 'Übernommen',
    niko_name(v_me) || ' übernimmt ' || niko_label(v_slot.day, v_slot.kind) || '.', '',
    'slot-' || v_slot.day || '-' || v_slot.kind);
  return jsonb_build_object('ok', true, 'day', v_slot.day, 'kind', v_slot.kind);
end $$;

create or replace function niko_add_notice(p_token text, p_day date, p_title text, p_body text, p_bring_by time)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_id uuid;
  v_wd text;
begin
  if coalesce(btrim(p_title), '') = '' then raise exception 'niko: Titel fehlt'; end if;
  insert into niko_notices (day, title, body, bring_by, created_by)
  values (p_day, left(btrim(p_title), 120), nullif(left(btrim(coalesce(p_body, '')), 1000), ''), p_bring_by, v_me)
  returning id into v_id;
  v_wd := (array['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])[extract(isodow from p_day)::int] || ' ' || to_char(p_day, 'FMDD.FMMM.');
  perform niko_push(niko_others(v_me), 'Kindergarten: ' || left(btrim(p_title), 120),
    concat_ws(' ', v_wd,
      'Bis spätestens ' || to_char(p_bring_by, 'FMHH24:MI') || ' im Kindergarten.',
      nullif(left(btrim(coalesce(p_body, '')), 200), '')),
    '', 'notice-' || v_id);
  return v_id;
end $$;

-- ---------- Erinnerung am Morgen ----------

drop function if exists niko_morning();
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
begin
  if extract(isodow from v_today) > 5 or extract(hour from v_now) <> 7 then return; end if;
  if exists (select 1 from niko_config where key = 'morning_last' and value = v_today::text) then return; end if;
  insert into niko_config (key, value) values ('morning_last', v_today::text)
    on conflict (key) do update set value = excluded.value;

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

-- 7 Uhr Wiener Zeit, Montag bis Freitag. pg_cron rechnet in UTC, darum zwei Zeiten
-- (Winter- und Sommerzeit). niko_morning prüft selbst, ob es 7 Uhr ist.
do $$ begin
  perform cron.schedule('niko-morning', '0 5,6 * * 1-5', 'select niko_morning()');
exception when others then raise warning 'niko: Zeitplan nicht angelegt (%)', sqlerrm;
end $$;

-- ---------- Rechte ----------

revoke all on function niko_label(date, text) from public;
revoke all on function niko_resolve(date, text) from public;
revoke all on function niko_push(text[], text, text, text, text) from public;
revoke all on function niko_others(text) from public;
revoke all on function niko_name(text) from public;
revoke all on function niko_morning(timestamp) from public;
revoke all on function niko_push_subscribe(text, text, text, text) from public;
revoke all on function niko_push_unsubscribe(text, text) from public;
revoke all on function niko_push_gone(text, text[]) from public;
revoke all on function niko_set_slot(text, date, text, text, text) from public;
revoke all on function niko_ask(text, date, text) from public;
revoke all on function niko_accept(text, uuid) from public;
revoke all on function niko_add_notice(text, date, text, text, time) from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function niko_label(date, text), niko_resolve(date, text), niko_push(text[], text, text, text, text), niko_others(text), niko_name(text), niko_morning(timestamp) from %I', r);
      execute format('grant execute on function niko_push_subscribe(text, text, text, text) to %I', r);
      execute format('grant execute on function niko_push_unsubscribe(text, text) to %I', r);
      execute format('grant execute on function niko_push_gone(text, text[]) to %I', r);
      execute format('grant execute on function niko_set_slot(text, date, text, text, text) to %I', r);
      execute format('grant execute on function niko_ask(text, date, text) to %I', r);
      execute format('grant execute on function niko_accept(text, uuid) to %I', r);
      execute format('grant execute on function niko_add_notice(text, date, text, text, time) to %I', r);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
