-- Staging-only Supabase regression. All synthetic rows are rolled back.
begin;

insert into auth.users (
  instance_id,id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-4111-8111-111111111111','authenticated','authenticated','agentdesk-staging-a@example.invalid',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-4222-8222-222222222222','authenticated','authenticated','agentdesk-staging-b@example.invalid',now(),'{}','{}',now(),now());

insert into public.business_profiles(user_id,business_name,description) values
  ('11111111-1111-4111-8111-111111111111','Synthetic Account A','A-only staging data'),
  ('22222222-2222-4222-8222-222222222222','Synthetic Account B','B-only staging data');
insert into public.agent_settings(user_id,allowed_domains) values
  ('11111111-1111-4111-8111-111111111111',array['a.example.invalid']),
  ('22222222-2222-4222-8222-222222222222',array['b.example.invalid']);
insert into public.widget_settings(user_id,agent_name) values
  ('11111111-1111-4111-8111-111111111111','Synthetic A Agent'),
  ('22222222-2222-4222-8222-222222222222','Synthetic B Agent');

select public.billing_ensure_free_subscription('11111111-1111-4111-8111-111111111111');
select public.billing_ensure_free_subscription('22222222-2222-4222-8222-222222222222');

do $test$
declare v_count integer; v_result jsonb;
begin
  if (select count(*) from public.subscription_plans) <> 3 then raise exception 'Plan catalog mismatch'; end if;
  if (select monthly_response_limit from public.subscription_plans where code='free') <> 100 then raise exception 'Free quota mismatch'; end if;
  if (select monthly_response_limit from public.subscription_plans where code='starter') <> 2000 then raise exception 'Starter quota mismatch'; end if;
  if (select monthly_response_limit from public.subscription_plans where code='pro') <> 10000 then raise exception 'Pro quota mismatch'; end if;
  if has_table_privilege('authenticated','public.subscriptions','select') then raise exception 'Browser can read subscriptions directly'; end if;
  if has_table_privilege('authenticated','public.billing_events','select') then raise exception 'Browser can read events directly'; end if;
  if has_table_privilege('authenticated','public.payment_transactions','select') then raise exception 'Browser can read transactions directly'; end if;
  if has_function_privilege('authenticated','public.billing_ensure_free_subscription(uuid)','execute') then raise exception 'Browser can create subscriptions'; end if;
  if has_function_privilege('authenticated','public.billing_process_verified_event(text,text,text,text,text,text,text,text,timestamptz)','execute') then raise exception 'Browser can reconcile payments'; end if;

  update public.subscriptions set pending_plan_id='starter',status='incomplete',provider='synthetic',
    provider_customer_ref='cus-a',provider_subscription_ref='sub-a'
    where user_id='11111111-1111-4111-8111-111111111111';
  select public.billing_process_verified_event('synthetic','evt-a','subscription.active','cus-a','sub-a','txn-a','starter','active',now()) into v_result;
  if (v_result->>'duplicate')::boolean then raise exception 'First event marked duplicate'; end if;
  select public.billing_process_verified_event('synthetic','evt-a','subscription.active','cus-a','sub-a','txn-a','starter','active',now()) into v_result;
  if not (v_result->>'duplicate')::boolean then raise exception 'Replay was not idempotent'; end if;
  if (select monthly_limit from public.usage_limits where user_id='11111111-1111-4111-8111-111111111111') <> 2000 then raise exception 'Starter entitlement missing'; end if;
  if (select count(*) from public.billing_events where user_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'Duplicate billing event'; end if;
  if (select count(*) from public.payment_transactions where user_id='11111111-1111-4111-8111-111111111111') <> 1 then raise exception 'Duplicate transaction'; end if;

  update public.subscriptions set pending_plan_id='pro',status='incomplete',provider='synthetic',
    provider_customer_ref='cus-b',provider_subscription_ref='sub-b'
    where user_id='22222222-2222-4222-8222-222222222222';
  perform public.billing_process_verified_event('synthetic','evt-b','subscription.active','cus-b','sub-b','txn-b','pro','active',now()-interval '2 months');
  update public.subscriptions set current_period_end=now()-interval '1 month' where user_id='22222222-2222-4222-8222-222222222222';
  select public.billing_security_reserve_ai_usage('22222222-2222-4222-8222-222222222222') into v_result;
  if v_result->>'plan' <> 'free' or (v_result->>'monthly_limit')::integer <> 100 then raise exception 'Expired subscription retained paid entitlement'; end if;

  select public.billing_process_verified_event('synthetic','evt-cancel','subscription.canceled','cus-a','sub-a',null,'starter','canceled',now()) into v_result;
  select public.billing_security_reserve_ai_usage('11111111-1111-4111-8111-111111111111') into v_result;
  if v_result->>'plan' <> 'free' then raise exception 'Canceled subscription retained paid entitlement'; end if;
  select public.billing_process_verified_event('synthetic','evt-cancel','subscription.canceled','cus-a','sub-a',null,'starter','canceled',now()) into v_result;
  if not (v_result->>'duplicate')::boolean then raise exception 'Canceled replay was not idempotent'; end if;

  update public.usage_limits set messages_used=99 where user_id='11111111-1111-4111-8111-111111111111';
  select public.billing_security_reserve_ai_usage('11111111-1111-4111-8111-111111111111') into v_result;
  if not (v_result->>'allowed')::boolean then raise exception 'Final Free request should be allowed'; end if;
  select public.billing_security_reserve_ai_usage('11111111-1111-4111-8111-111111111111') into v_result;
  if (v_result->>'allowed')::boolean then raise exception 'Free quota bypass'; end if;
end
$test$;

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $rls$
begin
  if (select count(*) from public.business_profiles) <> 1 then raise exception 'Cross-account SELECT leak'; end if;
  if exists (select 1 from public.business_profiles where user_id='22222222-2222-4222-8222-222222222222') then raise exception 'Account B visible to A'; end if;
  update public.business_profiles set description='blocked' where user_id='22222222-2222-4222-8222-222222222222';
  if found then raise exception 'Cross-account UPDATE succeeded'; end if;
  if has_table_privilege('authenticated','public.business_profiles','delete') then
    raise exception 'Authenticated role unexpectedly has DELETE privilege';
  end if;
  begin
    insert into public.business_profiles(user_id,business_name) values('22222222-2222-4222-8222-222222222222','blocked');
    raise exception 'Cross-account INSERT succeeded';
  exception when insufficient_privilege or unique_violation then null;
  end;
end
$rls$;
reset role;

select jsonb_build_object(
  'result','all_staging_billing_assertions_passed',
  'plans',(select count(*) from public.subscription_plans),
  'synthetic_accounts',(select count(*) from public.subscriptions),
  'events',(select count(*) from public.billing_events),
  'transactions',(select count(*) from public.payment_transactions)
) as evidence;

rollback;

select jsonb_build_object(
  'synthetic_auth_users',(select count(*) from auth.users where email like 'agentdesk-staging-%@example.invalid'),
  'synthetic_subscriptions',(select count(*) from public.subscriptions),
  'synthetic_events',(select count(*) from public.billing_events),
  'synthetic_transactions',(select count(*) from public.payment_transactions)
) as cleanup_evidence;
