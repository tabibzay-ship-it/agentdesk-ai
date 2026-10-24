-- AgentDesk platform administration foundation.
-- Apply only after backup verification and a separate production authorization.

create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'super_admin' check (role = 'super_admin'),
  is_active boolean not null default true,
  mfa_required boolean not null default true check (mfa_required is true),
  provisioned_at timestamptz not null default now(),
  provisioned_via text not null default 'database_owner' check (provisioned_via = 'database_owner'),
  provision_reason text not null check (char_length(provision_reason) between 8 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  target_type text check (target_type is null or target_type ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  target_id text check (target_id is null or char_length(target_id) between 1 and 200),
  outcome text not null check (outcome in ('allowed','denied','failed')),
  request_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists super_admins_active_idx on public.super_admins(is_active) where is_active is true;
create index if not exists admin_audit_events_created_idx on public.admin_audit_events(created_at desc);
create index if not exists admin_audit_events_admin_created_idx on public.admin_audit_events(admin_user_id, created_at desc);
create index if not exists admin_audit_events_action_created_idx on public.admin_audit_events(action, created_at desc);

alter table public.super_admins enable row level security;
alter table public.super_admins force row level security;
alter table public.admin_audit_events enable row level security;
alter table public.admin_audit_events force row level security;

-- Browser roles have no direct access. All authorization and sanitized reads
-- pass through server routes after an Auth server token check and AAL2 check.
revoke all on table public.super_admins, public.admin_audit_events from public, anon, authenticated;
revoke all on table public.super_admins, public.admin_audit_events from service_role;
grant select on table public.super_admins to service_role;
grant select, insert on table public.admin_audit_events to service_role;
grant usage, select on sequence public.admin_audit_events_id_seq to service_role;

create or replace function public.admin_provision_first_super_admin(
  p_user_id uuid,
  p_reason text
) returns public.super_admins
language plpgsql
security definer
set search_path = ''
as $function$
declare v_admin public.super_admins;
begin
  if p_user_id is null or p_reason is null or char_length(btrim(p_reason)) not between 8 and 240 then
    raise exception 'Invalid provisioning request';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and email_confirmed_at is not null) then
    raise exception 'The target must be an existing verified Auth user';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('agentdesk:first-super-admin', 0));
  if exists (select 1 from public.super_admins where is_active is true) then
    raise exception 'An active Super Admin already exists';
  end if;
  insert into public.super_admins(user_id, provision_reason)
    values (p_user_id, btrim(p_reason)) returning * into strict v_admin;
  insert into public.admin_audit_events(admin_user_id, action, target_type, target_id, outcome, metadata)
    values (p_user_id, 'admin.provisioned', 'super_admin', p_user_id::text, 'allowed',
      jsonb_build_object('method', 'database_owner', 'reason', btrim(p_reason)));
  return v_admin;
end $function$;

revoke all on function public.admin_provision_first_super_admin(uuid, text) from public, anon, authenticated, service_role;

comment on table public.super_admins is 'Database-owner-provisioned platform administrators; never writable by browser roles.';
comment on table public.admin_audit_events is 'Append-only server-side audit trail for platform-administrator access and actions.';
comment on function public.admin_provision_first_super_admin(uuid, text) is 'Database-owner-only, one-time bootstrap for the first verified Super Admin.';
