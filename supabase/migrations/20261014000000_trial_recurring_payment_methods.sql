-- AgentDesk trial, recurring-subscription metadata, and tokenized payment methods.
-- LOCAL REVIEW ONLY. This migration does not configure a provider or charge a card.

create table if not exists public.billing_program_config (
  id boolean primary key default true check (id),
  trial_launch_at timestamptz not null default now(),
  trial_days integer not null default 5 check (trial_days = 5),
  trial_credit_limit integer not null default 250 check (trial_credit_limit = 250),
  updated_at timestamptz not null default now()
);
insert into public.billing_program_config(id) values (true) on conflict (id) do nothing;

create table if not exists public.trial_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','exhausted','expired','converted')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  credit_limit integer not null default 250 check (credit_limit = 250),
  credits_used integer not null default 0 check (credits_used between 0 and credit_limit),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists trial_entitlements_status_ends_idx on public.trial_entitlements(status, ends_at);

create table if not exists agentdesk_private.trial_identity_claims (
  identity_hash text primary key check (identity_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

create table if not exists agentdesk_private.trial_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reserved_at timestamptz not null default now(),
  released_at timestamptz
);
create index if not exists trial_usage_reservations_user_idx on agentdesk_private.trial_usage_reservations(user_id, reserved_at desc);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (char_length(provider) between 1 and 64),
  provider_customer_ref text not null check (char_length(provider_customer_ref) between 1 and 255),
  provider_payment_method_ref text not null check (char_length(provider_payment_method_ref) between 1 and 255),
  brand text not null check (char_length(brand) between 1 and 32),
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  exp_month integer check (exp_month between 1 and 12),
  exp_year integer check (exp_year between 2020 and 2200),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','detached')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_payment_method_ref)
);
create index if not exists payment_methods_user_status_idx on public.payment_methods(user_id, status);
create unique index if not exists payment_methods_one_default_idx on public.payment_methods(user_id) where is_default and status='active';

alter table public.billing_program_config enable row level security;
alter table public.billing_program_config force row level security;
alter table public.trial_entitlements enable row level security;
alter table public.trial_entitlements force row level security;
alter table public.payment_methods enable row level security;
alter table public.payment_methods force row level security;
alter table agentdesk_private.trial_identity_claims enable row level security;
alter table agentdesk_private.trial_usage_reservations enable row level security;

revoke all on public.billing_program_config, public.trial_entitlements, public.payment_methods from public, anon, authenticated;
revoke all on agentdesk_private.trial_identity_claims, agentdesk_private.trial_usage_reservations from public, anon, authenticated;
grant all on public.billing_program_config, public.trial_entitlements, public.payment_methods to service_role;
grant all on agentdesk_private.trial_identity_claims, agentdesk_private.trial_usage_reservations to service_role;

create or replace function public.billing_ensure_trial_entitlement(p_user_id uuid)
returns public.trial_entitlements
language plpgsql security definer set search_path = '' as $function$
declare
  v_user auth.users;
  v_config public.billing_program_config;
  v_trial public.trial_entitlements;
  v_identity_hash text;
begin
  if p_user_id is null then raise exception 'Missing account'; end if;
  select * into strict v_user from auth.users where id=p_user_id;
  select * into strict v_config from public.billing_program_config where id=true;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_trial from public.trial_entitlements where user_id=p_user_id for update;
  if found then
    if v_trial.status='active' and v_trial.ends_at <= now() then
      update public.trial_entitlements set status='expired', ended_at=now(), updated_at=now()
        where user_id=p_user_id returning * into v_trial;
    elsif v_trial.status='active' and v_trial.credits_used >= v_trial.credit_limit then
      update public.trial_entitlements set status='exhausted', ended_at=now(), updated_at=now()
        where user_id=p_user_id returning * into v_trial;
    end if;
    return v_trial;
  end if;

  -- Existing accounts are not retroactively granted a trial. OAuth identities
  -- must also have a verified email before they can claim the one-time benefit.
  if v_user.created_at < v_config.trial_launch_at or v_user.email_confirmed_at is null or v_user.email is null then
    return null;
  end if;
  v_identity_hash := encode(extensions.digest(lower(btrim(v_user.email)), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_identity_hash, 0));
  insert into agentdesk_private.trial_identity_claims(identity_hash,user_id)
    values(v_identity_hash,p_user_id) on conflict(identity_hash) do nothing;
  if not exists (select 1 from agentdesk_private.trial_identity_claims where identity_hash=v_identity_hash and user_id=p_user_id) then
    return null;
  end if;
  insert into public.trial_entitlements(user_id,starts_at,ends_at,credit_limit)
    values(p_user_id,now(),now()+make_interval(days=>v_config.trial_days),v_config.trial_credit_limit)
    on conflict(user_id) do nothing;
  select * into v_trial from public.trial_entitlements where user_id=p_user_id;
  return v_trial;
end $function$;

create or replace function public.billing_security_reserve_ai_usage(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare v_subscription public.subscriptions; v_trial public.trial_entitlements; v_usage jsonb; v_reservation uuid;
begin
  perform public.billing_ensure_free_subscription(p_user_id);
  perform public.billing_ensure_trial_entitlement(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into strict v_subscription from public.subscriptions where user_id=p_user_id for update;
  if v_subscription.plan_id <> 'free' and
     (v_subscription.status not in ('active','trialing') or v_subscription.current_period_end is null or v_subscription.current_period_end <= now()) then
    update public.subscriptions set plan_id='free', pending_plan_id=null, status='active', cancel_at_period_end=false,
      provider=null, provider_customer_ref=null, provider_subscription_ref=null, updated_at=now() where id=v_subscription.id;
    update public.usage_limits set plan='free', monthly_limit=100 where user_id=p_user_id;
    v_subscription.plan_id := 'free';
  end if;
  if v_subscription.plan_id='free' then
    select * into v_trial from public.trial_entitlements where user_id=p_user_id for update;
    if found and v_trial.status='active' and v_trial.ends_at > now() and v_trial.credits_used < v_trial.credit_limit then
      insert into agentdesk_private.trial_usage_reservations(user_id) values(p_user_id) returning id into v_reservation;
      update public.trial_entitlements set credits_used=credits_used+1,
        status=case when credits_used+1 >= credit_limit then 'exhausted' else status end,
        ended_at=case when credits_used+1 >= credit_limit then now() else ended_at end, updated_at=now()
        where user_id=p_user_id returning * into v_trial;
      return jsonb_build_object('allowed',true,'plan','pro_trial','entitlement_source','trial',
        'used',v_trial.credits_used,'monthly_limit',v_trial.credit_limit,'remaining',v_trial.credit_limit-v_trial.credits_used,
        'period_start',v_trial.starts_at::date,'reservation_id',v_reservation,'trial_ends_at',v_trial.ends_at);
    end if;
    if found and v_trial.status='active' then
      update public.trial_entitlements set status=case when ends_at<=now() then 'expired' else 'exhausted' end,
        ended_at=coalesce(ended_at,now()),updated_at=now() where user_id=p_user_id;
    end if;
  end if;
  select public.security_reserve_ai_usage(p_user_id) into v_usage;
  return v_usage || jsonb_build_object('entitlement_source',case when v_subscription.plan_id='free' then 'free' else 'paid' end);
end $function$;

create or replace function public.billing_security_release_ai_usage(p_user_id uuid, p_reservation_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $function$
declare v_refunded boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  update agentdesk_private.trial_usage_reservations set released_at=now()
    where id=p_reservation_id and user_id=p_user_id and released_at is null;
  if found then
    update public.trial_entitlements set credits_used=greatest(0,credits_used-1),
      status=case when status='exhausted' and ends_at>now() then 'active' else status end,
      ended_at=case when status='exhausted' and ends_at>now() then null else ended_at end,updated_at=now()
      where user_id=p_user_id;
    return true;
  end if;
  select public.security_release_ai_usage(p_user_id,p_reservation_id) into v_refunded;
  return v_refunded;
end $function$;

create or replace function public.billing_process_verified_event_v2(
  p_provider text, p_event_id text, p_event_type text, p_customer_ref text,
  p_subscription_ref text, p_transaction_ref text, p_plan_code text,
  p_status text, p_occurred_at timestamptz, p_cancel_at_period_end boolean default false,
  p_period_start timestamptz default null, p_period_end timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_result jsonb; v_user_id uuid;
begin
  select public.billing_process_verified_event(p_provider,p_event_id,p_event_type,p_customer_ref,
    p_subscription_ref,p_transaction_ref,p_plan_code,p_status,p_occurred_at) into v_result;
  if coalesce((v_result->>'duplicate')::boolean,false) or coalesce((v_result->>'ignored')::boolean,false) then return v_result; end if;
  update public.subscriptions set cancel_at_period_end=p_cancel_at_period_end,
    current_period_start=coalesce(p_period_start,current_period_start),
    current_period_end=coalesce(p_period_end,current_period_end),updated_at=now()
    where provider=p_provider and provider_subscription_ref=p_subscription_ref returning user_id into v_user_id;
  if p_status='active' then
    update public.trial_entitlements set status='converted',ended_at=coalesce(ended_at,now()),updated_at=now()
      where user_id=v_user_id and status in ('active','exhausted','expired');
  end if;
  return v_result;
end $function$;

create or replace function public.billing_process_verified_payment_method(
  p_provider text,p_event_id text,p_event_type text,p_customer_ref text,p_payment_method_ref text,
  p_brand text,p_last4 text,p_exp_month integer,p_exp_year integer,p_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_subscription public.subscriptions; v_method public.payment_methods;
begin
  if p_last4 !~ '^[0-9]{4}$' or p_brand is null then raise exception 'Invalid safe payment metadata'; end if;
  if exists(select 1 from public.billing_events where provider=p_provider and provider_event_id=p_event_id) then return jsonb_build_object('duplicate',true); end if;
  select * into strict v_subscription from public.subscriptions where provider=p_provider and provider_customer_ref=p_customer_ref for update;
  update public.payment_methods set is_default=false,updated_at=now() where user_id=v_subscription.user_id and status='active';
  insert into public.payment_methods(user_id,provider,provider_customer_ref,provider_payment_method_ref,brand,last4,exp_month,exp_year,is_default)
    values(v_subscription.user_id,p_provider,p_customer_ref,p_payment_method_ref,lower(p_brand),p_last4,p_exp_month,p_exp_year,true)
    on conflict(provider,provider_payment_method_ref) do update set brand=excluded.brand,last4=excluded.last4,
      exp_month=excluded.exp_month,exp_year=excluded.exp_year,status='active',is_default=true,updated_at=now()
    returning * into v_method;
  insert into public.billing_events(user_id,subscription_id,provider,provider_event_id,event_type,outcome,occurred_at)
    values(v_subscription.user_id,v_subscription.id,p_provider,p_event_id,p_event_type,'processed',p_occurred_at);
  return jsonb_build_object('duplicate',false,'payment_method_id',v_method.id);
end $function$;

revoke all on function public.billing_ensure_trial_entitlement(uuid) from public,anon,authenticated;
revoke all on function public.billing_security_reserve_ai_usage(uuid) from public,anon,authenticated;
revoke all on function public.billing_security_release_ai_usage(uuid,uuid) from public,anon,authenticated;
revoke all on function public.billing_process_verified_event_v2(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.billing_process_verified_payment_method(text,text,text,text,text,text,text,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_ensure_trial_entitlement(uuid) to service_role;
grant execute on function public.billing_security_reserve_ai_usage(uuid) to service_role;
grant execute on function public.billing_security_release_ai_usage(uuid,uuid) to service_role;
grant execute on function public.billing_process_verified_event_v2(text,text,text,text,text,text,text,text,timestamptz,boolean,timestamptz,timestamptz) to service_role;
grant execute on function public.billing_process_verified_payment_method(text,text,text,text,text,text,text,integer,integer,timestamptz) to service_role;

comment on table public.trial_entitlements is 'One lifetime 5-day/250-credit trial, separate from monthly Free usage.';
comment on table public.payment_methods is 'Provider-token references and display metadata only; never PAN or CVV.';
