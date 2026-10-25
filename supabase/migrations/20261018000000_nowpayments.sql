-- NOWPayments orders are server-owned. Browser roles never receive table or
-- function privileges; signed IPNs are reconciled atomically by service_role.
create table if not exists public.nowpayments_payment_orders (
  order_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  kind text not null check (kind in ('initial','renewal')),
  status text not null check (status in ('creating','api_error','waiting','confirming','confirmed','sending','partially_paid','finished','failed','refunded','expired')),
  provider_invoice_id text unique,
  provider_payment_id text unique,
  activated_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nowpayments_orders_user_created_idx
  on public.nowpayments_payment_orders(user_id, created_at desc);
alter table public.nowpayments_payment_orders enable row level security;
alter table public.nowpayments_payment_orders force row level security;
revoke all on public.nowpayments_payment_orders from public, anon, authenticated;
grant all on public.nowpayments_payment_orders to service_role;

create or replace function public.billing_process_nowpayments_ipn(
  p_order_id uuid, p_payment_id text, p_status text, p_price_amount numeric,
  p_price_currency text, p_occurred_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $function$
declare
  v_order public.nowpayments_payment_orders;
  v_subscription public.subscriptions;
  v_plan public.subscription_plans;
  v_event_id text;
  v_activate boolean;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if p_payment_id is null or length(p_payment_id) > 255 or p_status not in
    ('waiting','confirming','confirmed','sending','partially_paid','finished','failed','refunded','expired') then
    raise exception 'Invalid NOWPayments event';
  end if;
  v_event_id := p_payment_id || ':' || p_status;
  if exists(select 1 from public.billing_events where provider='nowpayments' and provider_event_id=v_event_id) then
    return jsonb_build_object('duplicate',true,'activated',false);
  end if;

  select * into strict v_order from public.nowpayments_payment_orders where order_id=p_order_id for update;
  select * into strict v_plan from public.subscription_plans where code=v_order.plan_code and active is true and price_cents > 0;
  if round(p_price_amount * 100) <> v_order.amount_cents or upper(p_price_currency) <> v_order.currency then
    raise exception 'NOWPayments amount or currency mismatch';
  end if;
  if v_order.provider_payment_id is not null and v_order.provider_payment_id <> p_payment_id then
    raise exception 'NOWPayments payment identity mismatch';
  end if;
  if v_order.last_event_at is not null and p_occurred_at < v_order.last_event_at then
    insert into public.billing_events(user_id,provider,provider_event_id,event_type,outcome,occurred_at)
      values(v_order.user_id,'nowpayments',v_event_id,'payment.'||p_status,'ignored',p_occurred_at);
    return jsonb_build_object('duplicate',false,'ignored',true,'activated',false);
  end if;

  perform public.billing_ensure_free_subscription(v_order.user_id);
  select * into strict v_subscription from public.subscriptions where user_id=v_order.user_id for update;
  v_activate := p_status in ('confirmed','finished') and v_order.activated_at is null;
  if v_activate then
    if v_order.kind='renewal' and (v_subscription.provider <> 'nowpayments' or v_subscription.plan_id <> v_order.plan_code) then
      raise exception 'Invalid NOWPayments renewal';
    end if;
    v_period_start := greatest(coalesce(v_subscription.current_period_end,p_occurred_at),p_occurred_at);
    if v_order.kind='initial' then v_period_start := p_occurred_at; end if;
    v_period_end := v_period_start + interval '1 month';
    update public.subscriptions set plan_id=v_order.plan_code,pending_plan_id=null,status='active',billing_period='monthly',
      current_period_start=v_period_start,current_period_end=v_period_end,cancel_at_period_end=false,canceled_at=null,
      provider='nowpayments',provider_customer_ref=coalesce(provider_customer_ref,v_order.order_id::text),
      provider_subscription_ref=coalesce(provider_subscription_ref,v_order.order_id::text),provider_event_at=p_occurred_at,updated_at=now()
      where id=v_subscription.id;
    update public.usage_limits set plan=v_order.plan_code,monthly_limit=v_plan.monthly_response_limit where user_id=v_order.user_id;
    insert into public.payment_transactions(user_id,subscription_id,provider,provider_transaction_ref,amount_cents,currency,status,occurred_at)
      values(v_order.user_id,v_subscription.id,'nowpayments',p_payment_id,v_order.amount_cents,v_order.currency,'succeeded',p_occurred_at)
      on conflict(provider,provider_transaction_ref) do nothing;
    update public.trial_entitlements set status='converted',ended_at=coalesce(ended_at,now()),updated_at=now()
      where user_id=v_order.user_id and status in ('active','exhausted','expired');
  elsif p_status='refunded' and v_order.activated_at is not null then
    update public.subscriptions set status='past_due',provider_event_at=p_occurred_at,updated_at=now() where id=v_subscription.id;
    update public.payment_transactions set status='refunded',updated_at=now()
      where provider='nowpayments' and provider_transaction_ref=p_payment_id;
  end if;

  update public.nowpayments_payment_orders set provider_payment_id=coalesce(provider_payment_id,p_payment_id),status=p_status,
    activated_at=case when v_activate then p_occurred_at else activated_at end,last_event_at=p_occurred_at,updated_at=now()
    where order_id=p_order_id;
  insert into public.billing_events(user_id,subscription_id,provider,provider_event_id,event_type,outcome,occurred_at)
    values(v_order.user_id,v_subscription.id,'nowpayments',v_event_id,'payment.'||p_status,'processed',p_occurred_at);
  return jsonb_build_object('duplicate',false,'activated',v_activate);
end $function$;

revoke all on function public.billing_process_nowpayments_ipn(uuid,text,text,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_process_nowpayments_ipn(uuid,text,text,numeric,text,timestamptz) to service_role;

comment on table public.nowpayments_payment_orders is 'Private server-created NOWPayments order ledger; no browser access.';
comment on function public.billing_process_nowpayments_ipn(uuid,text,text,numeric,text,timestamptz) is
  'Atomically validates a signature-verified NOWPayments IPN against its server-created order and activates at most once.';
