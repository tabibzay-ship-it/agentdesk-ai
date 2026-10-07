-- Apply to the existing AgentDesk database using the Supabase SQL editor.
-- This is one transaction: a missing prerequisite leaves the database unchanged.
-- Existing application tables/RPCs are required; this is not a new-project schema.
begin;

do $preflight$
declare
  v_table text;
  v_period_type oid;
begin
  foreach v_table in array array[
    'business_profiles', 'knowledge_sources', 'agent_settings', 'widget_settings',
    'conversations', 'messages', 'usage_limits'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'AgentDesk prerequisite table missing: %', v_table;
    end if;
  end loop;
  if to_regprocedure('public.reserve_ai_usage(uuid)') is null then
    raise exception 'Existing AgentDesk reserve_ai_usage(uuid) must be installed first';
  end if;
  select atttypid into v_period_type from pg_attribute
    where attrelid = 'public.usage_limits'::regclass and attname = 'period_start'
      and attnum > 0 and not attisdropped;
  if v_period_type = 'timestamptz'::regtype then
    if to_regprocedure('public.release_ai_usage(uuid,timestamptz)') is null then
      raise exception 'Timestamp accounting requires native release_ai_usage(uuid,timestamptz)';
    end if;
  elsif v_period_type = 'date'::regtype then
    if to_regprocedure('public.release_ai_usage(uuid,date)') is null then
      raise exception 'Date accounting requires release_ai_usage(uuid,date)';
    end if;
  else
    raise exception 'Unsupported usage_limits.period_start type; expected date or timestamptz';
  end if;
  -- The rate RPC is installed below; an existing/defaulted one is optional.
end
$preflight$;

grant usage on schema public to authenticated, service_role;
revoke create on schema public from public, anon, authenticated;

-- Also close pre-existing views/extra tables. A view owned by a privileged role
-- can otherwise expose the protected base tables despite their RLS policies.
do $relations$
declare v_relation record; v_columns text;
begin
  for v_relation in
    select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_relation.relname);
    -- Table REVOKE does not remove grants previously assigned to columns.
    select string_agg(quote_ident(attname), ', ' order by attnum) into v_columns
      from pg_attribute where attrelid = v_relation.oid and attnum > 0 and not attisdropped;
    if v_columns is not null then
      execute format('revoke all privileges (%s) on table public.%I from public, anon, authenticated', v_columns, v_relation.relname);
    end if;
    execute format('grant all privileges on table public.%I to service_role', v_relation.relname);
  end loop;
end
$relations$;

-- Remove every old policy on these tables. Permissive policies combine with OR,
-- so adding one good ownership policy cannot repair an older public policy.
do $policies$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'business_profiles', 'knowledge_sources', 'agent_settings', 'widget_settings',
    'conversations', 'messages', 'usage_limits'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    for v_policy in
      select policyname from pg_policies where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all privileges on table public.%I to service_role', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    if v_table <> 'messages' then
      execute format(
        'create policy agentdesk_owner_read on public.%I for select to authenticated using (user_id = (select auth.uid()))',
        v_table
      );
    end if;
  end loop;
end
$policies$;

create policy agentdesk_owner_read on public.messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ));

-- Browser writes are limited to owner-editable content. Billing counters,
-- generated public IDs, verified installation flags and chat history are server-only.
grant insert (user_id, business_name, description, email, phone, website, address),
  update (user_id, business_name, description, email, phone, website, address)
  on public.business_profiles to authenticated;
grant insert (user_id, title, content)
  on public.knowledge_sources to authenticated;
grant insert (user_id, is_active, tone, custom_instructions, allowed_domains, updated_at),
  update (user_id, is_active, tone, custom_instructions, allowed_domains, updated_at)
  on public.agent_settings to authenticated;
grant insert (user_id, agent_name, welcome_message, primary_color),
  update (user_id, agent_name, welcome_message, primary_color)
  on public.widget_settings to authenticated;

do $writes$
declare v_table text;
begin
  foreach v_table in array array['business_profiles', 'knowledge_sources', 'agent_settings', 'widget_settings'] loop
    execute format(
      'create policy agentdesk_owner_insert on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', v_table
    );
    if v_table <> 'knowledge_sources' then
      execute format(
        'create policy agentdesk_owner_update on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', v_table
      );
    end if;
  end loop;
end
$writes$;

-- Supabase grants function EXECUTE to PUBLIC by default. No browser feature in
-- this codebase calls a public RPC. Revoke all existing overloads, including
-- unknown security-definer helpers that could otherwise bypass table policies.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create schema if not exists agentdesk_private;
revoke all on schema agentdesk_private from public, anon, authenticated;
revoke create on schema agentdesk_private from service_role;

-- Independent atomic rate limit implementation: fixed-window increments are
-- serialized by the unique bucket row. Both per-agent and per-visitor limits
-- use this function; changing visitor IDs cannot evade the per-agent bucket.
create table if not exists agentdesk_private.chat_rate_buckets (
  agent_id uuid not null references auth.users(id) on delete cascade,
  visitor_id text not null,
  window_started timestamptz not null,
  requests integer not null check (requests between 1 and 1001),
  primary key (agent_id, visitor_id)
);
alter table agentdesk_private.chat_rate_buckets enable row level security;
revoke all on table agentdesk_private.chat_rate_buckets from public, anon, authenticated;

-- Preserve an existing function's argument names/defaults and dependencies.
-- PostgreSQL rejects removing defaults with CREATE OR REPLACE. Missing functions
-- are created with the secure body directly, inside this same transaction.
do $rate_definition$
declare
  v_arguments text := 'p_agent_id uuid, p_visitor_id text, p_limit integer, p_window_seconds integer';
  v_existing oid := to_regprocedure('public.check_chat_rate_limit(uuid,text,integer,integer)');
begin
  if v_existing is not null then
    if exists (select 1 from pg_proc where oid = v_existing
               and (prorettype <> 'boolean'::regtype or proretset or proargmodes is not null)) then
      raise exception 'Unexpected existing check_chat_rate_limit contract';
    end if;
    select pg_get_function_arguments(v_existing) into v_arguments;
  end if;
  execute format($definition$
create or replace function public.check_chat_rate_limit(%s)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_allowed boolean;
  v_now timestamptz := clock_timestamp();
  v_agent_id uuid := $1;
  v_visitor_id text := $2;
  v_limit integer := $3;
  v_window_seconds integer := $4;
begin
  if v_agent_id is null or v_visitor_id is null or length(v_visitor_id) not between 1 and 256 or
     v_limit is null or v_limit not between 1 and 1000 or
     v_window_seconds is null or v_window_seconds not between 1 and 3600 then
    raise exception 'Invalid rate limit arguments';
  end if;
  delete from agentdesk_private.chat_rate_buckets
    where agent_id = v_agent_id and window_started < v_now - interval '24 hours';
  insert into agentdesk_private.chat_rate_buckets as bucket
    (agent_id, visitor_id, window_started, requests)
    values (v_agent_id, v_visitor_id, v_now, 1)
    on conflict (agent_id, visitor_id) do update set
      requests = case
        when bucket.window_started + make_interval(secs => v_window_seconds) <= v_now then 1
        else least(bucket.requests + 1, v_limit + 1)
      end,
      window_started = case
        when bucket.window_started + make_interval(secs => v_window_seconds) <= v_now then v_now
        else bucket.window_started
      end
    returning requests <= v_limit into v_allowed;
  return v_allowed;
end
$function$;
$definition$, v_arguments);
end
$rate_definition$;
revoke all on function public.check_chat_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.check_chat_rate_limit(uuid,text,integer,integer) to service_role;

-- Reviewed production accounting functions use schema-qualified tables/types.
-- Retain their implementation, row locking, entitlements and timestamp guard.
alter function public.reserve_ai_usage(uuid) set search_path = '';
do $release_compatibility$
begin
  if (select atttypid = 'timestamptz'::regtype from pg_attribute
      where attrelid = 'public.usage_limits'::regclass and attname = 'period_start'
        and attnum > 0 and not attisdropped) then
    alter function public.release_ai_usage(uuid,timestamptz) set search_path = '';
    -- Repair the previously installed date compatibility overload only if it
    -- exists. Date represents UTC midnight, never session-local midnight.
    if to_regprocedure('public.release_ai_usage(uuid,date)') is not null then
      execute $definition$
        create or replace function public.release_ai_usage(p_user_id uuid, p_period_start date)
        returns void language sql security definer set search_path = ''
        as $function$
          select public.release_ai_usage($1, $2::timestamp at time zone 'UTC');
        $function$;
      $definition$;
    end if;
  else
    alter function public.release_ai_usage(uuid,date) set search_path = '';
  end if;
end
$release_compatibility$;

-- Keep accounting implementation compatibility while making failure refunds
-- attributable and exactly-once. A refund never trusts a caller-supplied month.
create table if not exists agentdesk_private.ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_start_at timestamptz,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
-- An already-applied date-ledger migration can be rerun without replacing rows.
-- Do not invent lost timestamps for its old reservations: refunds fail closed.
alter table agentdesk_private.ai_usage_reservations
  add column if not exists period_start_at timestamptz;
alter table agentdesk_private.ai_usage_reservations enable row level security;
revoke all on table agentdesk_private.ai_usage_reservations from public, anon, authenticated;

create or replace function public.security_reserve_ai_usage(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
  v_usage jsonb;
  v_reservation uuid;
  v_period date;
  v_period_at timestamptz;
begin
  if p_user_id is null then raise exception 'Missing account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  delete from agentdesk_private.ai_usage_reservations
    where user_id = p_user_id and created_at < now() - interval '62 days';
  select pg_catalog.to_jsonb(result) into strict v_usage
    from public.reserve_ai_usage(p_user_id) as result;
  if jsonb_typeof(v_usage) <> 'object' then
    raise exception 'Unexpected usage RPC result';
  end if;
  if (v_usage ->> 'allowed')::boolean is true then
    if (select atttypid = 'timestamptz'::regtype from pg_attribute
        where attrelid = 'public.usage_limits'::regclass and attname = 'period_start'
          and attnum > 0 and not attisdropped) then
      v_period_at := (v_usage ->> 'period_start')::timestamptz;
      v_period := (v_period_at at time zone 'UTC')::date;
    else
      v_period := (v_usage ->> 'period_start')::date;
    end if;
    if v_period is null then raise exception 'Usage RPC did not return its reserved period'; end if;
    insert into agentdesk_private.ai_usage_reservations (user_id, period_start, period_start_at)
      values (p_user_id, v_period, v_period_at) returning id into v_reservation;
    v_usage := v_usage || jsonb_build_object('reservation_id', v_reservation);
  end if;
  return v_usage;
end
$function$;

create or replace function public.security_release_ai_usage(p_user_id uuid, p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare v_period date; v_period_at timestamptz;
begin
  if p_user_id is null then raise exception 'Missing account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  -- The row lock and underlying refund commit or roll back together. Concurrent
  -- retries cannot decrement a counter twice, including across a month boundary.
  select period_start, period_start_at into v_period, v_period_at
    from agentdesk_private.ai_usage_reservations
    where id = p_reservation_id and user_id = p_user_id and released_at is null
    for update;
  if not found then return false; end if;
  if (select atttypid = 'timestamptz'::regtype from pg_attribute
      where attrelid = 'public.usage_limits'::regclass and attname = 'period_start'
        and attnum > 0 and not attisdropped) then
    if v_period_at is null then
      raise exception 'Legacy reservation lacks its exact timestamp; review before refund';
    end if;
    perform public.release_ai_usage(p_user_id, v_period_at);
  else
    perform public.release_ai_usage(p_user_id, v_period);
  end if;
  update agentdesk_private.ai_usage_reservations
    set released_at = now() where id = p_reservation_id;
  return true;
end
$function$;

revoke all on function public.security_reserve_ai_usage(uuid) from public, anon, authenticated;
revoke all on function public.security_release_ai_usage(uuid,uuid) from public, anon, authenticated;
grant execute on function public.security_reserve_ai_usage(uuid) to service_role;
grant execute on function public.security_release_ai_usage(uuid,uuid) to service_role;

-- Validate future writes without deleting or rewriting existing customer data.
-- NOT VALID means legacy oversize rows remain readable; every new/updated row
-- must meet the bound. Validate constraints after remediating any legacy rows.
alter table public.business_profiles drop constraint if exists agentdesk_business_input_bounds;
alter table public.business_profiles add constraint agentdesk_business_input_bounds check (
  user_id is not null and length(coalesce(business_name, '')) between 1 and 200 and
  length(coalesce(description, '')) <= 20000 and length(coalesce(email, '')) <= 254 and
  length(coalesce(phone, '')) <= 100 and length(coalesce(website, '')) <= 2048 and
  length(coalesce(address, '')) <= 2000
) not valid;
alter table public.knowledge_sources drop constraint if exists agentdesk_knowledge_input_bounds;
alter table public.knowledge_sources add constraint agentdesk_knowledge_input_bounds check (
  user_id is not null and length(coalesce(title, '')) between 1 and 200 and
  length(coalesce(content, '')) between 1 and 200000
) not valid;
alter table public.agent_settings drop constraint if exists agentdesk_agent_input_bounds;
alter table public.agent_settings add constraint agentdesk_agent_input_bounds check (
  user_id is not null and tone is not null and tone in ('professional', 'friendly', 'concise') and
  length(coalesce(custom_instructions, '')) <= 2000 and
  allowed_domains is not null and cardinality(allowed_domains) between 0 and 100 and
  array_position(allowed_domains, null) is null and
  length(array_to_string(allowed_domains, '')) <= 25300
) not valid;
alter table public.widget_settings drop constraint if exists agentdesk_widget_input_bounds;
alter table public.widget_settings add constraint agentdesk_widget_input_bounds check (
  user_id is not null and length(coalesce(agent_name, '')) between 1 and 200 and
  length(coalesce(welcome_message, '')) <= 2000 and
  primary_color is not null and primary_color ~ '^#[0-9a-fA-F]{6}$'
) not valid;

notify pgrst, 'reload schema';
commit;
