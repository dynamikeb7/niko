-- NiKo: Bring- und Abholplan für den Kindergartenweg
-- Schema und Funktionen für Supabase (Postgres).
-- Die Tabellen sind für die öffentliche API gesperrt. Zugriff gibt es nur über
-- die niko_*-Funktionen, und jede davon verlangt den persönlichen Link-Token.

create table if not exists niko_people (
  id text primary key,
  name text not null,
  family text not null check (family in ('a', 'b')),
  token text not null unique,
  handover_time time,
  handover_place text,
  sort int not null default 0
);

create table if not exists niko_standard (
  parity text not null check (parity in ('even', 'odd')),
  weekday int not null check (weekday between 0 and 4),
  kind text not null check (kind in ('bring', 'pick')),
  status text not null check (status in ('person', 'separate', 'open')),
  person_id text references niko_people (id),
  detail text,
  primary key (parity, weekday, kind),
  check ((status = 'person') = (person_id is not null))
);

create table if not exists niko_slots (
  day date not null,
  kind text not null check (kind in ('bring', 'pick')),
  status text not null check (status in ('person', 'separate', 'open', 'asked')),
  person_id text references niko_people (id),
  asked_by text references niko_people (id),
  request_id uuid unique,
  updated_by text references niko_people (id),
  updated_at timestamptz not null default now(),
  primary key (day, kind),
  check ((status = 'person') = (person_id is not null))
);

create table if not exists niko_notes (
  day date primary key,
  body text not null,
  updated_by text references niko_people (id),
  updated_at timestamptz not null default now()
);

create table if not exists niko_notices (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  title text not null,
  body text,
  bring_by time,
  created_by text references niko_people (id),
  created_at timestamptz not null default now()
);

create index if not exists niko_notices_day on niko_notices (day);

alter table niko_people enable row level security;
alter table niko_standard enable row level security;
alter table niko_slots enable row level security;
alter table niko_notes enable row level security;
alter table niko_notices enable row level security;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on niko_people, niko_standard, niko_slots, niko_notes, niko_notices from %I', r);
    end if;
  end loop;
end $$;

-- Wer ist das? Wirft einen Fehler bei unbekanntem Token.
create or replace function niko_who(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_id text;
begin
  select id into v_id from niko_people where token = p_token;
  if v_id is null then
    raise exception 'niko: unbekannter Link' using errcode = '28000';
  end if;
  return v_id;
end $$;

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
      from niko_notices where day between p_from and p_to)
  );
end $$;

-- Einen Tag ändern: Person eintragen, getrennt, offen oder zurück zum Standardplan.
create or replace function niko_set_slot(p_token text, p_day date, p_kind text, p_status text, p_person text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me text := niko_who(p_token);
begin
  if p_kind not in ('bring', 'pick') then raise exception 'niko: Art ungültig'; end if;
  if extract(isodow from p_day) > 5 then raise exception 'niko: nur Montag bis Freitag'; end if;
  if p_status = 'reset' then
    delete from niko_slots where day = p_day and kind = p_kind;
    return;
  end if;
  if p_status not in ('person', 'separate', 'open') then raise exception 'niko: Status ungültig'; end if;
  insert into niko_slots (day, kind, status, person_id, asked_by, request_id, updated_by, updated_at)
  values (p_day, p_kind, p_status, case when p_status = 'person' then p_person end, null, null, v_me, now())
  on conflict (day, kind) do update
    set status = excluded.status, person_id = excluded.person_id, asked_by = null,
        request_id = null, updated_by = v_me, updated_at = now();
end $$;

-- Einen Dienst abgeben: Der Tag wird offen markiert und bekommt eine Anfrage-ID für den WhatsApp-Link.
create or replace function niko_ask(p_token text, p_day date, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_req uuid := gen_random_uuid();
begin
  if p_kind not in ('bring', 'pick') then raise exception 'niko: Art ungültig'; end if;
  if extract(isodow from p_day) > 5 then raise exception 'niko: nur Montag bis Freitag'; end if;
  insert into niko_slots (day, kind, status, person_id, asked_by, request_id, updated_by, updated_at)
  values (p_day, p_kind, 'asked', null, v_me, v_req, v_me, now())
  on conflict (day, kind) do update
    set status = 'asked', person_id = null, asked_by = v_me, request_id = v_req,
        updated_by = v_me, updated_at = now();
  return v_req;
end $$;

-- Was steht hinter einem Anfrage-Link?
create or replace function niko_request(p_token text, p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := niko_who(p_token);
  v_slot niko_slots;
begin
  select * into v_slot from niko_slots where request_id = p_request;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true, 'day', v_slot.day, 'kind', v_slot.kind, 'status', v_slot.status,
    'person_id', v_slot.person_id, 'asked_by', v_slot.asked_by, 'me', v_me);
end $$;

-- Eine Anfrage übernehmen. Wenn jemand schneller war, bleibt es bei dieser Person.
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
  return jsonb_build_object('ok', true, 'day', v_slot.day, 'kind', v_slot.kind);
end $$;

create or replace function niko_set_note(p_token text, p_day date, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_me text := niko_who(p_token);
begin
  if coalesce(btrim(p_body), '') = '' then
    delete from niko_notes where day = p_day;
  else
    insert into niko_notes (day, body, updated_by, updated_at)
    values (p_day, left(btrim(p_body), 500), v_me, now())
    on conflict (day) do update set body = excluded.body, updated_by = v_me, updated_at = now();
  end if;
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
begin
  if coalesce(btrim(p_title), '') = '' then raise exception 'niko: Titel fehlt'; end if;
  insert into niko_notices (day, title, body, bring_by, created_by)
  values (p_day, left(btrim(p_title), 120), nullif(left(btrim(coalesce(p_body, '')), 1000), ''), p_bring_by, v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function niko_delete_notice(p_token text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform niko_who(p_token);
  delete from niko_notices where id = p_id;
end $$;

create or replace function niko_set_standard(p_token text, p_parity text, p_weekday int, p_kind text, p_status text, p_person text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform niko_who(p_token);
  insert into niko_standard (parity, weekday, kind, status, person_id, detail)
  values (p_parity, p_weekday, p_kind, p_status,
          case when p_status = 'person' then p_person end,
          nullif(left(btrim(coalesce(p_detail, '')), 200), ''))
  on conflict (parity, weekday, kind) do update
    set status = excluded.status, person_id = excluded.person_id, detail = excluded.detail;
end $$;

-- Nur die API-Funktionen sind von außen aufrufbar.
revoke all on function niko_who(text) from public;
revoke all on function niko_load(text, date, date) from public;
revoke all on function niko_set_slot(text, date, text, text, text) from public;
revoke all on function niko_ask(text, date, text) from public;
revoke all on function niko_request(text, uuid) from public;
revoke all on function niko_accept(text, uuid) from public;
revoke all on function niko_set_note(text, date, text) from public;
revoke all on function niko_add_notice(text, date, text, text, time) from public;
revoke all on function niko_delete_notice(text, uuid) from public;
revoke all on function niko_set_standard(text, text, int, text, text, text, text) from public;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function niko_who(text) from %I', r);
      execute format('grant execute on function niko_load(text, date, date) to %I', r);
      execute format('grant execute on function niko_set_slot(text, date, text, text, text) to %I', r);
      execute format('grant execute on function niko_ask(text, date, text) to %I', r);
      execute format('grant execute on function niko_request(text, uuid) to %I', r);
      execute format('grant execute on function niko_accept(text, uuid) to %I', r);
      execute format('grant execute on function niko_set_note(text, date, text) to %I', r);
      execute format('grant execute on function niko_add_notice(text, date, text, text, time) to %I', r);
      execute format('grant execute on function niko_delete_notice(text, uuid) to %I', r);
      execute format('grant execute on function niko_set_standard(text, text, int, text, text, text, text) to %I', r);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
