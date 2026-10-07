-- Run after the hardening migration in Supabase SQL editor. Read-only: no
-- secret values, chat text, business content or function bodies are returned.
-- All seven tables must show both RLS flags true.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in (
  'business_profiles', 'knowledge_sources', 'agent_settings', 'widget_settings',
  'conversations', 'messages', 'usage_limits'
) order by c.relname;

-- Only the strict owner policies installed by the migration should appear.
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- This query must return zero rows: no anonymously exposed public relations.
select c.relname as unexpectedly_public_relation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and (
  has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or
  has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE')
);

-- This must return zero rows, including every old RPC overload/helper.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig as function_settings
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'agentdesk_private') and (
  has_function_privilege('anon', p.oid, 'EXECUTE') or
  has_function_privilege('authenticated', p.oid, 'EXECUTE')
);

-- All of these must be false. Owner data is SELECT-only on billing/history;
-- public IDs and installation verification cannot be forged by browser writes.
select
  has_table_privilege('authenticated', 'public.usage_limits', 'INSERT,UPDATE,DELETE') as billing_write,
  has_table_privilege('authenticated', 'public.messages', 'INSERT,UPDATE,DELETE') as message_write,
  has_table_privilege('authenticated', 'public.conversations', 'INSERT,UPDATE,DELETE') as conversation_write,
  has_column_privilege('authenticated', 'public.agent_settings', 'public_agent_id', 'INSERT,UPDATE') as public_id_write,
  has_column_privilege('authenticated', 'public.widget_settings', 'is_installed', 'INSERT,UPDATE') as verification_write;

-- The old atomic RPCs must still be reviewed for row locking, counter bounds,
-- month transitions, and safe search_path. These signatures/settings do not
-- prove their implementation; inspect bodies privately in the SQL editor.
select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result, p.proconfig as function_settings,
       p.pronargdefaults as default_argument_count,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in (
  'check_chat_rate_limit', 'reserve_ai_usage', 'release_ai_usage',
  'security_reserve_ai_usage', 'security_release_ai_usage'
);

-- Production uses timestamptz. Date-only schemas remain supported separately.
-- Exact reservation timestamps must be available for timestamp accounting.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where (table_schema = 'public' and table_name = 'usage_limits' and column_name = 'period_start')
   or (table_schema = 'agentdesk_private' and table_name = 'ai_usage_reservations'
       and column_name in ('period_start', 'period_start_at'))
order by table_schema, table_name, column_name;

-- Must be zero for this production timestamp schema. Do not reconstruct old
-- timestamps from truncated dates if a previous ledger migration existed.
select count(*) as unreleased_reservations_missing_timestamp
from agentdesk_private.ai_usage_reservations
where released_at is null and period_start_at is null
  and exists (select 1 from pg_attribute where attrelid = 'public.usage_limits'::regclass
              and attname = 'period_start' and atttypid = 'timestamptz'::regtype);

-- NOT VALID constraints apply to every new/update write. If legacy rows exist,
-- inspect them privately before VALIDATE CONSTRAINT; never bulk-delete data.
select c.relname as table_name, con.conname, con.convalidated
from pg_constraint con join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and con.conname like 'agentdesk_%_input_bounds';
