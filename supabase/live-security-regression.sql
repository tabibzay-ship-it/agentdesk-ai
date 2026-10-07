-- Run only after hardening, as the SQL editor's postgres role.
-- Real RPCs and RLS are exercised with existing accounts, without printing IDs.
-- Every temporary counter, reservation and bucket change is rolled back.
begin;
create temporary table agentdesk_test_result(result jsonb);
do $test$
declare
  v_accounts uuid[];
  v_owner uuid;
  v_other uuid;
  v_table text;
  v_usage jsonb;
  v_before integer;
  v_after integer;
  v_count integer;
  v_allowed integer := 0;
  v_period timestamptz;
  v_test_period timestamptz := (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC';
  v_next_period timestamptz := (date_trunc('month', now() at time zone 'UTC') + interval '2 months') at time zone 'UTC';
  v_visitor text := 'security-review-' || gen_random_uuid()::text;
  v_timezone text;
begin
  select array_agg(user_id) into v_accounts from
    (select distinct user_id from public.business_profiles where user_id is not null order by user_id limit 2) a;
  if cardinality(v_accounts) <> 2 then raise exception 'Two existing accounts are required'; end if;
  v_owner := v_accounts[1]; v_other := v_accounts[2];
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('business_profiles','knowledge_sources','agent_settings','widget_settings','conversations','messages','usage_limits')
      and c.relrowsecurity and c.relforcerowsecurity) <> 7 then raise exception 'RLS flags failed'; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v','m','f') and
      (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE'))) then raise exception 'Anonymous relation exposed'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','agentdesk_private') and
      (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Browser RPC exposed'; end if;
  if has_table_privilege('authenticated','public.usage_limits','INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated','public.messages','INSERT,UPDATE,DELETE') or
     has_table_privilege('authenticated','public.conversations','INSERT,UPDATE,DELETE') or
     has_column_privilege('authenticated','public.agent_settings','public_agent_id','INSERT,UPDATE') or
     has_column_privilege('authenticated','public.widget_settings','is_installed','INSERT,UPDATE') then raise exception 'Server field writable'; end if;
  foreach v_owner in array v_accounts loop
    v_other := case when v_owner=v_accounts[1] then v_accounts[2] else v_accounts[1] end;
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub',v_owner::text,true);
    foreach v_table in array array['business_profiles','knowledge_sources','agent_settings','widget_settings','conversations','usage_limits'] loop
      execute format('select count(*) from public.%I where user_id <> $1',v_table) into v_count using v_owner;
      if v_count <> 0 then raise exception 'Cross-account read: %',v_table; end if;
    end loop;
    select count(*) into v_count from public.messages m where not exists
      (select 1 from public.conversations c where c.id=m.conversation_id and c.user_id=v_owner);
    if v_count <> 0 then raise exception 'Cross-account message read'; end if;
    update public.business_profiles set description=description where user_id=v_other;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'Cross-account business update'; end if;
    update public.agent_settings set tone=tone where user_id=v_other;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'Cross-account agent update'; end if;
    update public.widget_settings set agent_name=agent_name where user_id=v_other;
    get diagnostics v_count = row_count;
    if v_count <> 0 then raise exception 'Cross-account widget update'; end if;
    begin
      insert into public.knowledge_sources(user_id,title,content) values(v_other,'Security test','Temporary transaction');
      raise exception 'Cross-account knowledge insert permitted';
    exception when insufficient_privilege then null; end;
    begin
      update public.usage_limits set messages_used=messages_used where user_id=v_owner;
      raise exception 'Billing update permitted';
    exception when insufficient_privilege then null; end;
    begin
      perform public.check_chat_rate_limit(v_owner,'forbidden',1,60);
      raise exception 'Authenticated rate RPC permitted';
    exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
  execute 'set local role anon';
  begin
    perform 1 from public.business_profiles;
    raise exception 'Anonymous data access permitted';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  v_owner := v_accounts[1]; v_other := v_accounts[2];
  select messages_used,period_start into strict v_before,v_period from public.usage_limits where user_id=v_owner;
  execute 'set local role service_role';
  select public.security_reserve_ai_usage(v_owner) into v_usage;
  if (v_usage->>'allowed')::boolean is not true then raise exception 'Test account has no usage capacity'; end if;
  if public.security_release_ai_usage(v_other,(v_usage->>'reservation_id')::uuid) then raise exception 'Wrong owner refund'; end if;
  if not public.security_release_ai_usage(v_owner,(v_usage->>'reservation_id')::uuid) then raise exception 'Refund failed'; end if;
  if public.security_release_ai_usage(v_owner,(v_usage->>'reservation_id')::uuid) then raise exception 'Duplicate refund'; end if;
  select messages_used into v_after from public.usage_limits where user_id=v_owner;
  if v_after <> v_before then raise exception 'Refund changed original counter'; end if;
  for v_count in 1..11 loop
    if public.check_chat_rate_limit(v_owner,v_visitor,10,60) then v_allowed := v_allowed+1; end if;
  end loop;
  if v_allowed <> 10 then raise exception 'Rate threshold failed'; end if;
  execute 'reset role';

  -- Simulate a rollover without replacing native RPC definitions or wall time.
  update public.usage_limits set period_start=v_test_period,messages_used=0 where user_id=v_owner;
  select public.security_reserve_ai_usage(v_owner) into v_usage;
  update public.usage_limits set period_start=v_next_period,messages_used=2 where user_id=v_owner;
  perform public.security_release_ai_usage(v_owner,(v_usage->>'reservation_id')::uuid);
  select messages_used into v_after from public.usage_limits where user_id=v_owner;
  if v_after <> 2 then raise exception 'Old-month refund decremented new-month usage'; end if;
  foreach v_timezone in array array['Asia/Kabul','America/Los_Angeles','Pacific/Kiritimati'] loop
    perform set_config('TimeZone',v_timezone,true);
    update public.usage_limits set period_start=v_test_period,messages_used=1 where user_id=v_owner;
    perform public.release_ai_usage(v_owner,(v_test_period at time zone 'UTC')::date);
    select messages_used into v_after from public.usage_limits where user_id=v_owner;
    if v_after <> 0 then raise exception 'UTC date compatibility failed: %',v_timezone; end if;
  end loop;
  insert into agentdesk_test_result values (jsonb_build_object(
    'rls_tables',7,'anonymous_relations_exposed',0,'browser_rpcs_exposed',0,
    'two_account_reads_and_writes','passed','service_role_usage_and_refund','passed',
    'wrong_owner_and_duplicate_refund','passed','rate_allowed_of_11',v_allowed,
    'old_month_cannot_refund_new_month','passed','utc_date_wrapper_three_timezones','passed',
    'test_changes','rolled back'));
end
$test$;
select result as live_security_regression from agentdesk_test_result;
rollback;
select 'All live security assertions passed; transaction rolled back' as status;
