\set ON_ERROR_STOP on

-- Disposable PostgreSQL 17 verification for 20261017000000_ai_credit_controls.sql.
-- The bare Supabase database image does not run GoTrue's schema upgrades, so
-- this compatibility column mirrors the production Auth API field used by the
-- already-reviewed trial migration.
alter table auth.users add column if not exists email_confirmed_at timestamptz;

create or replace function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is not true then raise exception 'ASSERTION FAILED: %', message; end if;
end $$;

insert into auth.users(id,email,confirmed_at,email_confirmed_at,created_at,updated_at,raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111','credit-a@example.test',now(),now(),now()-interval '30 days',now(),'{}'),
  ('22222222-2222-4222-8222-222222222222','credit-b@example.test',now(),now(),now()-interval '30 days',now(),'{}')
on conflict(id) do nothing;

select public.billing_ensure_free_subscription('11111111-1111-4111-8111-111111111111');
select public.billing_ensure_free_subscription('22222222-2222-4222-8222-222222222222');

select pg_temp.assert_true(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.ai_credit_control_config'::regclass),
  'credit config must force RLS');
select pg_temp.assert_true(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.ai_operation_costs'::regclass),
  'operation costs must force RLS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.ai_credit_control_config','select'),
  'authenticated must not read credit config');
select pg_temp.assert_true(not has_table_privilege('authenticated','agentdesk_private.ai_credit_ledger','select'),
  'authenticated must not read the private ledger');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.billing_security_reserve_ai_operation(uuid,text,uuid)','execute'),
  'authenticated must not reserve server-side credits');
select pg_temp.assert_true(has_function_privilege('service_role','public.billing_security_reserve_ai_operation(uuid,text,uuid)','execute'),
  'service role must execute the reservation RPC');

update public.ai_credit_control_config set provider_enabled=true,emergency_shutdown=false,
  per_user_daily_credit_limit=250,global_daily_credit_limit=10000 where id=true;

create temporary table pg_temp.results(value jsonb);
insert into pg_temp.results select public.billing_security_reserve_ai_operation(
  '11111111-1111-4111-8111-111111111111','image_edit','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.assert_true((select (value->>'allowed')::boolean and (value->>'credits_charged')::int=5 from pg_temp.results),
  'image edit must reserve exactly five credits');
select pg_temp.assert_true((select messages_used=5 from public.usage_limits where user_id='11111111-1111-4111-8111-111111111111'),
  'entitlement deduction must equal operation cost');
select pg_temp.assert_true(public.billing_security_settle_ai_operation(
  '11111111-1111-4111-8111-111111111111',(select (value->>'credit_reservation_id')::uuid from pg_temp.results),21,8),
  'first settlement must succeed');
select pg_temp.assert_true(not public.billing_security_settle_ai_operation(
  '11111111-1111-4111-8111-111111111111',(select (value->>'credit_reservation_id')::uuid from pg_temp.results),21,8),
  'settlement replay must fail closed');
select pg_temp.assert_true((select count(*)=2 from agentdesk_private.ai_credit_ledger where user_id='11111111-1111-4111-8111-111111111111'),
  'reserve and settle ledger entries must be durable');

truncate pg_temp.results;
insert into pg_temp.results select public.billing_security_reserve_ai_operation(
  '22222222-2222-4222-8222-222222222222','attachment_analysis','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.assert_true(not public.billing_security_release_ai_operation(
  '11111111-1111-4111-8111-111111111111',(select (value->>'credit_reservation_id')::uuid from pg_temp.results)),
  'cross-account refund must be denied');
select pg_temp.assert_true(public.billing_security_release_ai_operation(
  '22222222-2222-4222-8222-222222222222',(select (value->>'credit_reservation_id')::uuid from pg_temp.results)),
  'owner exact refund must succeed');
select pg_temp.assert_true(not public.billing_security_release_ai_operation(
  '22222222-2222-4222-8222-222222222222',(select (value->>'credit_reservation_id')::uuid from pg_temp.results)),
  'refund replay must fail closed');
select pg_temp.assert_true((select messages_used=0 from public.usage_limits where user_id='22222222-2222-4222-8222-222222222222'),
  'refund must restore exactly the owner deduction');

update public.ai_credit_control_config set per_user_daily_credit_limit=5,global_daily_credit_limit=10000 where id=true;
select pg_temp.assert_true((public.billing_security_reserve_ai_operation(
  '11111111-1111-4111-8111-111111111111','text_chat',null)->>'reason')='daily_user_limit',
  'per-user daily ceiling must fail closed');
update public.ai_credit_control_config set emergency_shutdown=true where id=true;
select pg_temp.assert_true((public.billing_security_reserve_ai_operation(
  '22222222-2222-4222-8222-222222222222','text_chat',null)->>'reason')='provider_disabled',
  'emergency shutdown must fail before charging');
update public.ai_credit_control_config set emergency_shutdown=false,per_user_daily_credit_limit=100,
  global_daily_credit_limit=6 where id=true;
select pg_temp.assert_true((public.billing_security_reserve_ai_operation(
  '22222222-2222-4222-8222-222222222222','text_chat',null)->>'allowed')::boolean,
  'the final global credit must be reservable');
select pg_temp.assert_true((public.billing_security_reserve_ai_operation(
  '22222222-2222-4222-8222-222222222222','text_chat',null)->>'reason')='daily_global_limit',
  'global daily ceiling must fail closed');

-- A transaction rollback must remove the reservation, ledger row and usage
-- deduction together.
select count(*) as reservations_before_rollback from agentdesk_private.ai_credit_reservations \gset
select messages_used as usage_before_rollback from public.usage_limits where user_id='22222222-2222-4222-8222-222222222222' \gset
update public.ai_credit_control_config set global_daily_credit_limit=10000 where id=true;
begin;
select public.billing_security_reserve_ai_operation('22222222-2222-4222-8222-222222222222','text_chat',null);
rollback;
select pg_temp.assert_true((select count(*) from agentdesk_private.ai_credit_reservations)=:reservations_before_rollback,
  'rolled-back reservation must not persist');
select pg_temp.assert_true((select messages_used from public.usage_limits where user_id='22222222-2222-4222-8222-222222222222')=:usage_before_rollback,
  'rolled-back entitlement deduction must not persist');

select 'AI_CREDIT_PG17_CORE_PASS' as result;
