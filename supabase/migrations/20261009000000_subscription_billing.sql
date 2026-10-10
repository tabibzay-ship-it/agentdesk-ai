-- AgentDesk subscription and billing foundation.
-- REVIEW BEFORE APPLYING. This migration does not connect or charge a payment provider.

create table if not exists public.subscription_plans (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null check (char_length(description) between 1 and 240),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  agent_limit integer not null check (agent_limit > 0),
  monthly_response_limit integer not null check (monthly_response_limit > 0),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans
  (code, name, description, price_cents, currency, agent_limit, monthly_response_limit, active, display_order)
values
  ('free', 'Free', 'For testing your first customer-support agent.', 0, 'USD', 1, 100, true, 10),
  ('starter', 'Starter', 'For small teams ready to support more customers.', 900, 'USD', 3, 2000, true, 20),
  ('pro', 'Pro', 'For growing support operations.', 2900, 'USD', 10, 10000, true, 30)
on conflict (code) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan_id text not null references public.subscription_plans(code),
  pending_plan_id text references public.subscription_plans(code),
  status text not null check (status in ('incomplete','active','trialing','past_due','canceled','expired')),
  billing_period text not null default 'monthly' check (billing_period = 'monthly'),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  provider text,
  provider_customer_ref text,
  provider_subscription_ref text,
  provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_period_order check (current_period_end is null or current_period_start is null or current_period_end > current_period_start),
  constraint paid_provider_identity check ((plan_id = 'free' and pending_plan_id is null) or (provider is not null and provider_customer_ref is not null and provider_subscription_ref is not null))
);

-- Keep reruns compatible with a staging database that applied an earlier local
-- draft before provider event ordering was enforced.
alter table public.subscriptions add column if not exists provider_event_at timestamptz;

create unique index if not exists subscriptions_provider_customer_unique
  on public.subscriptions(provider, provider_customer_ref) where provider_customer_ref is not null;
create unique index if not exists subscriptions_provider_subscription_unique
  on public.subscriptions(provider, provider_subscription_ref) where provider_subscription_ref is not null;
create index if not exists subscriptions_status_period_end_idx on public.subscriptions(status, current_period_end);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  outcome text not null check (outcome in ('processed','ignored','failed')),
  occurred_at timestamptz,
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);
create index if not exists billing_events_user_created_idx on public.billing_events(user_id, created_at desc);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null,
  provider_transaction_ref text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null check (status in ('pending','succeeded','failed','refunded')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_transaction_ref)
);
create index if not exists payment_transactions_user_created_idx on public.payment_transactions(user_id, created_at desc);

alter table public.subscription_plans enable row level security;
alter table public.subscription_plans force row level security;
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_transactions force row level security;

drop policy if exists "active plans are readable" on public.subscription_plans;
create policy "active plans are readable" on public.subscription_plans for select to authenticated using (active is true);
drop policy if exists "accounts read own subscription" on public.subscriptions;
create policy "accounts read own subscription" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "accounts read own billing events" on public.billing_events;
create policy "accounts read own billing events" on public.billing_events for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "accounts read own transactions" on public.payment_transactions;
create policy "accounts read own transactions" on public.payment_transactions for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.subscription_plans, public.subscriptions, public.billing_events, public.payment_transactions from public, anon, authenticated;
-- Private billing rows are returned only by authenticated server endpoints in a
-- deliberately sanitized shape. RLS remains enabled as defense in depth, but
-- browser roles receive no table privilege that could expose provider refs.
grant select on public.subscription_plans to authenticated;
grant all on public.subscription_plans, public.subscriptions, public.billing_events, public.payment_transactions to service_role;

create or replace function public.billing_ensure_free_subscription(p_user_id uuid)
returns public.subscriptions
language plpgsql security definer set search_path = '' as $function$
declare v_subscription public.subscriptions;
begin
  if p_user_id is null then raise exception 'Missing account'; end if;
  if not exists (select 1 from auth.users where id = p_user_id) then raise exception 'Unknown account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  insert into public.subscriptions(user_id, plan_id, status, current_period_start)
    values (p_user_id, 'free', 'active', date_trunc('month', now()))
    on conflict (user_id) do nothing;
  insert into public.usage_limits(user_id, plan, monthly_limit, messages_used)
    values (p_user_id, 'free', 100, 0)
    on conflict (user_id) do nothing;
  select * into strict v_subscription from public.subscriptions where user_id = p_user_id;
  return v_subscription;
end $function$;

-- Called by chat instead of the original security wrapper. Expiration fallback
-- and reservation occur in the same transaction and retain rollback/refund behavior.
create or replace function public.billing_security_reserve_ai_usage(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare v_subscription public.subscriptions; v_usage jsonb;
begin
  perform public.billing_ensure_free_subscription(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into strict v_subscription from public.subscriptions where user_id = p_user_id for update;
  if v_subscription.plan_id <> 'free' and
     (v_subscription.status not in ('active','trialing') or v_subscription.current_period_end is null or v_subscription.current_period_end <= now()) then
    update public.subscriptions set plan_id='free', pending_plan_id=null, status='active', cancel_at_period_end=false,
      provider=null, provider_customer_ref=null, provider_subscription_ref=null, updated_at=now()
      where id=v_subscription.id;
    update public.usage_limits set plan='free', monthly_limit=100 where user_id=p_user_id;
  end if;
  select public.security_reserve_ai_usage(p_user_id) into v_usage;
  return v_usage;
end $function$;

-- Only a verified provider adapter may call this function. The unique provider
-- event key makes retries idempotent. Customer ownership is derived from the
-- existing server-created provider mapping, never from webhook/browser user IDs.
create or replace function public.billing_process_verified_event(
  p_provider text, p_event_id text, p_event_type text, p_customer_ref text,
  p_subscription_ref text, p_transaction_ref text, p_plan_code text,
  p_status text, p_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_subscription public.subscriptions; v_plan public.subscription_plans;
begin
  if p_provider is null or p_event_id is null or p_customer_ref is null or p_subscription_ref is null then raise exception 'Invalid verified event'; end if;
  if p_status not in ('active','past_due','canceled') then raise exception 'Invalid subscription status'; end if;
  if exists (select 1 from public.billing_events where provider=p_provider and provider_event_id=p_event_id) then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into strict v_plan from public.subscription_plans where code=p_plan_code and active is true and price_cents > 0;
  select * into strict v_subscription from public.subscriptions
    where provider=p_provider and provider_customer_ref=p_customer_ref and provider_subscription_ref=p_subscription_ref for update;
  if exists (select 1 from public.billing_events where provider=p_provider and provider_event_id=p_event_id) then
    return jsonb_build_object('duplicate', true);
  end if;
  if v_subscription.provider_event_at is not null and p_occurred_at < v_subscription.provider_event_at then
    insert into public.billing_events(user_id,subscription_id,provider,provider_event_id,event_type,outcome,occurred_at)
      values(v_subscription.user_id,v_subscription.id,p_provider,p_event_id,p_event_type,'ignored',p_occurred_at);
    return jsonb_build_object('duplicate', false, 'ignored', true);
  end if;
  update public.subscriptions set plan_id=case when p_status='active' then p_plan_code else plan_id end,
    pending_plan_id=case when p_status='active' then null else pending_plan_id end,
    status=p_status, current_period_start=case when p_status='active' then p_occurred_at else current_period_start end,
    current_period_end=case when p_status='active' then p_occurred_at + interval '1 month' else current_period_end end,
    canceled_at=case when p_status='canceled' then p_occurred_at else canceled_at end,
    provider_event_at=p_occurred_at, updated_at=now()
    where id=v_subscription.id;
  if p_status='active' then
    update public.usage_limits set plan=p_plan_code, monthly_limit=v_plan.monthly_response_limit where user_id=v_subscription.user_id;
  end if;
  insert into public.billing_events(user_id,subscription_id,provider,provider_event_id,event_type,outcome,occurred_at)
    values(v_subscription.user_id,v_subscription.id,p_provider,p_event_id,p_event_type,'processed',p_occurred_at);
  if p_transaction_ref is not null then
    insert into public.payment_transactions(user_id,subscription_id,provider,provider_transaction_ref,amount_cents,currency,status,occurred_at)
      values(v_subscription.user_id,v_subscription.id,p_provider,p_transaction_ref,v_plan.price_cents,v_plan.currency,'succeeded',p_occurred_at)
      on conflict(provider,provider_transaction_ref) do nothing;
  end if;
  return jsonb_build_object('duplicate', false);
end $function$;

revoke all on function public.billing_ensure_free_subscription(uuid) from public, anon, authenticated;
revoke all on function public.billing_security_reserve_ai_usage(uuid) from public, anon, authenticated;
revoke all on function public.billing_process_verified_event(text,text,text,text,text,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.billing_ensure_free_subscription(uuid) to service_role;
grant execute on function public.billing_security_reserve_ai_usage(uuid) to service_role;
grant execute on function public.billing_process_verified_event(text,text,text,text,text,text,text,text,timestamptz) to service_role;

comment on table public.subscription_plans is 'Server-managed configurable billing plans.';
comment on table public.subscriptions is 'One server-managed subscription per AgentDesk account.';
comment on table public.billing_events is 'Idempotent audit log of signature-verified provider events.';
comment on function public.billing_process_verified_event(text,text,text,text,text,text,text,text,timestamptz) is 'Service-role-only reconciliation after webhook signature verification.';
