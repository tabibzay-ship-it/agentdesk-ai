-- Auditable, optional marketing consent captured during Auth registration.
-- Prepared locally. Production execution requires separate authorization.

create table if not exists public.marketing_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  consented boolean not null default false,
  policy_version text not null check (policy_version ~ '^[0-9]{4}-[0-9]{2}$'),
  source text not null check (source in ('registration','settings')),
  consented_at timestamptz,
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((consented and consented_at is not null and withdrawn_at is null) or
         (not consented and consented_at is null))
);

create table if not exists public.marketing_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consented boolean not null,
  policy_version text not null check (policy_version ~ '^[0-9]{4}-[0-9]{2}$'),
  source text not null check (source in ('registration','settings')),
  recorded_at timestamptz not null default now()
);

create index if not exists marketing_consent_events_user_recorded_idx
  on public.marketing_consent_events(user_id, recorded_at desc);

alter table public.marketing_preferences enable row level security;
alter table public.marketing_preferences force row level security;
alter table public.marketing_consent_events enable row level security;
alter table public.marketing_consent_events force row level security;

revoke all on public.marketing_preferences, public.marketing_consent_events from public, anon, authenticated;
revoke all on sequence public.marketing_consent_events_id_seq from public, anon, authenticated;
grant select, insert, update on public.marketing_preferences to service_role;
grant select, insert on public.marketing_consent_events to service_role;
grant usage, select on sequence public.marketing_consent_events_id_seq to service_role;

create or replace function public.capture_initial_marketing_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_consented boolean := coalesce((new.raw_user_meta_data ->> 'marketing_consent')::boolean, false);
  v_policy text := coalesce(nullif(new.raw_user_meta_data ->> 'marketing_consent_policy', ''), '2026-10');
begin
  if v_policy !~ '^[0-9]{4}-[0-9]{2}$' then v_policy := '2026-10'; end if;
  insert into public.marketing_preferences(user_id, consented, policy_version, source, consented_at)
    values (new.id, v_consented, v_policy, 'registration', case when v_consented then now() end)
    on conflict (user_id) do nothing;
  insert into public.marketing_consent_events(user_id, consented, policy_version, source)
    values (new.id, v_consented, v_policy, 'registration');
  return new;
exception when others then
  -- Consent recording must not make account creation unavailable. Missing
  -- consent stays false and can be reconciled by an authorized server process.
  return new;
end $function$;

-- PostgreSQL 17 permits CREATE OR REPLACE TRIGGER with the table-level
-- TRIGGER privilege. Avoid a separate removal statement because removing a
-- trigger requires ownership of auth.users, which the managed production
-- role does not have.
create or replace trigger capture_initial_marketing_consent
  after insert on auth.users
  for each row execute function public.capture_initial_marketing_consent();

revoke all on function public.capture_initial_marketing_consent() from public, anon, authenticated, service_role;

create or replace function public.set_marketing_consent(
  p_user_id uuid,
  p_consented boolean,
  p_policy_version text default '2026-10'
) returns public.marketing_preferences
language plpgsql
security definer
set search_path = ''
as $function$
declare v_preference public.marketing_preferences;
begin
  if p_user_id is null or p_consented is null or p_policy_version !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Invalid marketing preference';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Unknown account';
  end if;
  insert into public.marketing_preferences(
    user_id, consented, policy_version, source, consented_at, withdrawn_at, updated_at
  ) values (
    p_user_id, p_consented, p_policy_version, 'settings',
    case when p_consented then now() end,
    case when not p_consented then now() end,
    now()
  ) on conflict (user_id) do update set
    consented=excluded.consented,
    policy_version=excluded.policy_version,
    source='settings',
    consented_at=case when excluded.consented then now() end,
    withdrawn_at=case when not excluded.consented then now() end,
    updated_at=now()
  returning * into strict v_preference;
  insert into public.marketing_consent_events(user_id, consented, policy_version, source)
    values (p_user_id, p_consented, p_policy_version, 'settings');
  return v_preference;
end $function$;

revoke all on function public.set_marketing_consent(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_marketing_consent(uuid, boolean, text) to service_role;

comment on table public.marketing_preferences is 'Current optional marketing preference; inaccessible to browser roles.';
comment on table public.marketing_consent_events is 'Append-only audit history for explicit marketing choices.';
comment on function public.set_marketing_consent(uuid, boolean, text) is 'Service-only, atomic consent update with immutable audit event.';
