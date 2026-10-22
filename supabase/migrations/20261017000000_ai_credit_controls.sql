-- Durable, provider-neutral AI credit controls.
-- LOCAL REVIEW ONLY. Apply to production only with the application release and
-- a separately authorized, verified database backup/migration procedure.

create table if not exists public.ai_credit_control_config (
  id boolean primary key default true check (id),
  provider_enabled boolean not null default true,
  emergency_shutdown boolean not null default false,
  per_user_daily_credit_limit integer not null default 250 check (per_user_daily_credit_limit between 1 and 100000),
  global_daily_credit_limit integer not null default 10000 check (global_daily_credit_limit between 1 and 10000000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.ai_credit_control_config(id) values(true) on conflict(id) do nothing;

create table if not exists public.ai_operation_costs (
  operation text primary key check (operation ~ '^[a-z][a-z0-9_]{2,63}$'),
  credit_cost integer not null check (credit_cost between 1 and 1000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.ai_operation_costs(operation,credit_cost) values
  ('text_chat',1),('attachment_analysis',2),('image_generation',8),('image_edit',5)
on conflict(operation) do nothing;

create table if not exists agentdesk_private.ai_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null references public.ai_operation_costs(operation) on update cascade,
  credits integer not null check (credits > 0),
  usage_reservation_ids uuid[] not null check (cardinality(usage_reservation_ids) = credits),
  status text not null default 'reserved' check (status in ('reserved','settled','refunded')),
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  refunded_at timestamptz,
  provider_input_tokens integer check (provider_input_tokens is null or provider_input_tokens >= 0),
  provider_output_tokens integer check (provider_output_tokens is null or provider_output_tokens >= 0),
  request_id uuid
);
create index if not exists ai_credit_reservations_user_day_idx
  on agentdesk_private.ai_credit_reservations(user_id,reserved_at desc);
create index if not exists ai_credit_reservations_day_idx
  on agentdesk_private.ai_credit_reservations(reserved_at desc);
create unique index if not exists ai_credit_reservations_request_idx
  on agentdesk_private.ai_credit_reservations(user_id,request_id) where request_id is not null;

create table if not exists agentdesk_private.ai_credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reservation_id uuid not null references agentdesk_private.ai_credit_reservations(id) on delete restrict,
  event_type text not null check (event_type in ('reserved','settled','refunded')),
  credit_delta integer not null,
  operation text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(reservation_id,event_type)
);
create index if not exists ai_credit_ledger_user_created_idx
  on agentdesk_private.ai_credit_ledger(user_id,created_at desc);

alter table public.ai_credit_control_config enable row level security;
alter table public.ai_credit_control_config force row level security;
alter table public.ai_operation_costs enable row level security;
alter table public.ai_operation_costs force row level security;
alter table agentdesk_private.ai_credit_reservations enable row level security;
alter table agentdesk_private.ai_credit_ledger enable row level security;

revoke all on public.ai_credit_control_config, public.ai_operation_costs from public,anon,authenticated;
revoke all on agentdesk_private.ai_credit_reservations, agentdesk_private.ai_credit_ledger from public,anon,authenticated;
grant select,update on public.ai_credit_control_config, public.ai_operation_costs to service_role;
grant select,insert,update on agentdesk_private.ai_credit_reservations to service_role;
grant select,insert on agentdesk_private.ai_credit_ledger to service_role;
grant usage,select on sequence agentdesk_private.ai_credit_ledger_id_seq to service_role;

create or replace function public.billing_security_reserve_ai_operation(
  p_user_id uuid, p_operation text, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $function$
declare
  v_config public.ai_credit_control_config;
  v_cost public.ai_operation_costs;
  v_base jsonb;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_reservation uuid;
  v_user_used bigint;
  v_global_used bigint;
  v_entitlement_source text;
  i integer;
begin
  if p_user_id is null or p_operation is null then raise exception 'Missing AI operation context'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agentdesk:ai-credit-global',0));
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into strict v_config from public.ai_credit_control_config where id=true for update;
  select * into v_cost from public.ai_operation_costs where operation=p_operation for update;
  if not found or not v_cost.enabled then
    return jsonb_build_object('allowed',false,'reason','operation_disabled','operation',p_operation);
  end if;
  if v_config.emergency_shutdown or not v_config.provider_enabled then
    return jsonb_build_object('allowed',false,'reason','provider_disabled','operation',p_operation);
  end if;
  if p_request_id is not null then
    select id into v_reservation from agentdesk_private.ai_credit_reservations
      where user_id=p_user_id and request_id=p_request_id;
    if found then return jsonb_build_object('allowed',false,'reason','duplicate_request','reservation_id',v_reservation); end if;
  end if;
  select coalesce(sum(credits),0) into v_user_used from agentdesk_private.ai_credit_reservations
    where user_id=p_user_id and reserved_at >= date_trunc('day',now()) and status <> 'refunded';
  select coalesce(sum(credits),0) into v_global_used from agentdesk_private.ai_credit_reservations
    where reserved_at >= date_trunc('day',now()) and status <> 'refunded';
  if v_user_used+v_cost.credit_cost > v_config.per_user_daily_credit_limit then
    return jsonb_build_object('allowed',false,'reason','daily_user_limit','used_today',v_user_used,'daily_limit',v_config.per_user_daily_credit_limit);
  end if;
  if v_global_used+v_cost.credit_cost > v_config.global_daily_credit_limit then
    return jsonb_build_object('allowed',false,'reason','daily_global_limit','used_today',v_global_used,'daily_limit',v_config.global_daily_credit_limit);
  end if;
  for i in 1..v_cost.credit_cost loop
    select public.billing_security_reserve_ai_usage(p_user_id) into v_base;
    if coalesce((v_base->>'allowed')::boolean,false) is not true then
      foreach v_id in array v_ids loop perform public.billing_security_release_ai_usage(p_user_id,v_id); end loop;
      return v_base || jsonb_build_object('operation',p_operation,'credits_required',v_cost.credit_cost);
    end if;
    v_id := (v_base->>'reservation_id')::uuid;
    v_ids := array_append(v_ids,v_id);
    if v_entitlement_source is null then
      v_entitlement_source := v_base->>'entitlement_source';
    elsif v_entitlement_source is distinct from v_base->>'entitlement_source' then
      foreach v_id in array v_ids loop perform public.billing_security_release_ai_usage(p_user_id,v_id); end loop;
      return jsonb_build_object('allowed',false,'reason','insufficient_single_entitlement','operation',p_operation,
        'credits_required',v_cost.credit_cost);
    end if;
  end loop;
  insert into agentdesk_private.ai_credit_reservations(user_id,operation,credits,usage_reservation_ids,request_id)
    values(p_user_id,p_operation,v_cost.credit_cost,v_ids,p_request_id) returning id into v_reservation;
  insert into agentdesk_private.ai_credit_ledger(user_id,reservation_id,event_type,credit_delta,operation)
    values(p_user_id,v_reservation,'reserved',v_cost.credit_cost,p_operation);
  return v_base || jsonb_build_object('allowed',true,'operation',p_operation,'credits_charged',v_cost.credit_cost,
    'credit_reservation_id',v_reservation,'daily_user_remaining',v_config.per_user_daily_credit_limit-v_user_used-v_cost.credit_cost,
    'daily_global_remaining',v_config.global_daily_credit_limit-v_global_used-v_cost.credit_cost);
end $function$;

create or replace function public.billing_security_settle_ai_operation(
  p_user_id uuid,p_reservation_id uuid,p_input_tokens integer default null,p_output_tokens integer default null
) returns boolean
language plpgsql security definer set search_path='' as $function$
declare v_row agentdesk_private.ai_credit_reservations;
begin
  if coalesce(p_input_tokens,0)<0 or coalesce(p_output_tokens,0)<0 then raise exception 'Invalid token usage'; end if;
  select * into v_row from agentdesk_private.ai_credit_reservations
    where id=p_reservation_id and user_id=p_user_id for update;
  if not found or v_row.status<>'reserved' then return false; end if;
  update agentdesk_private.ai_credit_reservations set status='settled',settled_at=now(),
    provider_input_tokens=p_input_tokens,provider_output_tokens=p_output_tokens where id=p_reservation_id;
  insert into agentdesk_private.ai_credit_ledger(user_id,reservation_id,event_type,credit_delta,operation,metadata)
    values(p_user_id,p_reservation_id,'settled',0,v_row.operation,
      jsonb_build_object('input_tokens',p_input_tokens,'output_tokens',p_output_tokens));
  return true;
end $function$;

create or replace function public.billing_security_release_ai_operation(p_user_id uuid,p_reservation_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare v_row agentdesk_private.ai_credit_reservations; v_id uuid;
begin
  select * into v_row from agentdesk_private.ai_credit_reservations
    where id=p_reservation_id and user_id=p_user_id for update;
  if not found or v_row.status<>'reserved' then return false; end if;
  foreach v_id in array v_row.usage_reservation_ids loop
    if public.billing_security_release_ai_usage(p_user_id,v_id) is not true then
      raise exception 'Underlying usage refund failed';
    end if;
  end loop;
  update agentdesk_private.ai_credit_reservations set status='refunded',refunded_at=now() where id=p_reservation_id;
  insert into agentdesk_private.ai_credit_ledger(user_id,reservation_id,event_type,credit_delta,operation)
    values(p_user_id,p_reservation_id,'refunded',0-v_row.credits,v_row.operation);
  return true;
end $function$;

create or replace function public.admin_update_ai_credit_controls(
  p_admin_user_id uuid,p_provider_enabled boolean,p_emergency_shutdown boolean,
  p_user_daily_limit integer,p_global_daily_limit integer,p_costs jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_item record;
begin
  if not exists(select 1 from public.super_admins where user_id=p_admin_user_id and is_active and mfa_required) then
    raise exception 'Administrator authorization required';
  end if;
  if p_user_daily_limit not between 1 and 100000 or p_global_daily_limit not between p_user_daily_limit and 10000000 then
    raise exception 'Invalid credit limits';
  end if;
  if jsonb_typeof(p_costs)<>'object' then raise exception 'Invalid operation costs'; end if;
  update public.ai_credit_control_config set provider_enabled=p_provider_enabled,
    emergency_shutdown=p_emergency_shutdown,per_user_daily_credit_limit=p_user_daily_limit,
    global_daily_credit_limit=p_global_daily_limit,updated_at=now(),updated_by=p_admin_user_id where id=true;
  for v_item in select key,value from jsonb_each_text(p_costs) loop
    if (v_item.value)::integer not between 1 and 1000 then raise exception 'Invalid operation cost'; end if;
    update public.ai_operation_costs set credit_cost=(v_item.value)::integer,updated_at=now(),updated_by=p_admin_user_id
      where operation=v_item.key;
    if not found then raise exception 'Unknown AI operation'; end if;
  end loop;
  return jsonb_build_object('updated',true);
end $function$;

revoke all on function public.billing_security_reserve_ai_operation(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.billing_security_settle_ai_operation(uuid,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.billing_security_release_ai_operation(uuid,uuid) from public,anon,authenticated;
revoke all on function public.admin_update_ai_credit_controls(uuid,boolean,boolean,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.billing_security_reserve_ai_operation(uuid,text,uuid) to service_role;
grant execute on function public.billing_security_settle_ai_operation(uuid,uuid,integer,integer) to service_role;
grant execute on function public.billing_security_release_ai_operation(uuid,uuid) to service_role;
grant execute on function public.admin_update_ai_credit_controls(uuid,boolean,boolean,integer,integer,jsonb) to service_role;

comment on table agentdesk_private.ai_credit_ledger is 'Append-only financial audit trail; never directly accessible to browser roles.';
comment on table public.ai_credit_control_config is 'Fail-closed AI provider switch and daily credit ceilings.';
