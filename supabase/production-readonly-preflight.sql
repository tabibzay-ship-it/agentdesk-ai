-- Production catalog preflight. This transaction is explicitly read-only and
-- never queries customer-owned table rows.
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '45s';

select jsonb_build_object(
  'database', jsonb_build_object(
    'server_version', current_setting('server_version'),
    'database_size_bytes', pg_database_size(current_database()),
    'extensions', (
      select coalesce(jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname),'[]'::jsonb)
      from pg_extension where extname in ('pgcrypto','plpgsql','uuid-ossp')
    )
  ),
  'required_relations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', required.name,
      'exists', c.oid is not null,
      'kind', c.relkind,
      'rls', coalesce(c.relrowsecurity,false),
      'forced_rls', coalesce(c.relforcerowsecurity,false)
    ) order by required.name),'[]'::jsonb)
    from (values
      ('agent_settings'),('business_profiles'),('conversations'),('knowledge_sources'),
      ('messages'),('usage_limits'),('widget_settings'),
      ('subscription_plans'),('subscriptions'),('billing_events'),('payment_transactions')
    ) required(name)
    left join pg_class c on c.oid=to_regclass('public.'||required.name)
  ),
  'required_columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',expected.table_name,'column',expected.column_name,'expected',expected.expected_type,
      'actual',format_type(a.atttypid,a.atttypmod),'exists',a.attnum is not null
    ) order by expected.table_name,expected.column_name),'[]'::jsonb)
    from (values
      ('business_profiles','user_id','uuid'),('business_profiles','description','text'),
      ('knowledge_sources','user_id','uuid'),('agent_settings','user_id','uuid'),
      ('agent_settings','public_agent_id','uuid'),('agent_settings','allowed_domains','text[]'),
      ('widget_settings','user_id','uuid'),('widget_settings','is_installed','boolean'),
      ('conversations','user_id','uuid'),('messages','conversation_id','uuid'),
      ('usage_limits','user_id','uuid'),('usage_limits','plan','text'),
      ('usage_limits','monthly_limit','integer'),('usage_limits','messages_used','integer'),
      ('usage_limits','period_start','date or timestamptz')
    ) expected(table_name,column_name,expected_type)
    left join pg_attribute a on a.attrelid=to_regclass('public.'||expected.table_name)
      and a.attname=expected.column_name and a.attnum>0 and not a.attisdropped
  ),
  'ownership_constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',c.relname,'name',con.conname,'type',con.contype,'definition',pg_get_constraintdef(con.oid,true)
    ) order by c.relname,con.conname),'[]'::jsonb)
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'business_profiles','knowledge_sources','agent_settings','widget_settings','conversations','messages','usage_limits'
    ) and con.contype in ('p','u','f','c')
  ),
  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef)
      order by tablename,indexname),'[]'::jsonb)
    from pg_indexes where schemaname='public' and tablename in (
      'business_profiles','knowledge_sources','agent_settings','widget_settings','conversations','messages','usage_limits',
      'subscription_plans','subscriptions','billing_events','payment_transactions'
    )
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',tablename,'name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check
    ) order by tablename,policyname),'[]'::jsonb)
    from pg_policies where schemaname='public' and tablename in (
      'business_profiles','knowledge_sources','agent_settings','widget_settings','conversations','messages','usage_limits',
      'subscription_plans','subscriptions','billing_events','payment_transactions'
    )
  ),
  'rpc_compatibility', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',p.proname,
      'arguments',pg_get_function_identity_arguments(p.oid),
      'result',pg_get_function_result(p.oid),
      'security_definer',p.prosecdef,
      'settings',coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
      'anon_execute',has_function_privilege('anon',p.oid,'execute'),
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'execute'),
      'service_execute',has_function_privilege('service_role',p.oid,'execute')
    ) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'check_chat_rate_limit','reserve_ai_usage','release_ai_usage',
      'security_reserve_ai_usage','security_release_ai_usage',
      'billing_ensure_free_subscription','billing_security_reserve_ai_usage','billing_process_verified_event'
    )
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)
    ) order by n.nspname,c.relname,t.tgname),'[]'::jsonb)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','auth')
  ),
  'table_privileges', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'table',table_name,'grantee',grantee,'privilege',privilege_type
    ) order by table_name,grantee,privilege_type),'[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema='public' and table_name in (
      'business_profiles','knowledge_sources','agent_settings','widget_settings','conversations','messages','usage_limits',
      'subscription_plans','subscriptions','billing_events','payment_transactions'
    ) and grantee in ('anon','authenticated','service_role')
  ),
  'migration_ledger', jsonb_build_object(
    'exists',to_regclass('supabase_migrations.schema_migrations') is not null,
    'note','Ledger versions are queried separately only when the optional relation exists.'
  ),
  'catalog_relations', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',c.relname,'kind',c.relkind,
      'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forced_rls',c.relforcerowsecurity
    ) order by n.nspname,c.relname),'[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','agentdesk_private')
      and c.relkind in ('r','p','v','m','S')
  ),
  'catalog_columns', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'table',c.relname,'column',a.attname,
      'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
      'identity',a.attidentity,'generated',a.attgenerated
    ) order by n.nspname,c.relname,a.attnum),'[]'::jsonb)
    from pg_attribute a
    join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','agentdesk_private')
      and c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped
  ),
  'catalog_constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'table',c.relname,'name',con.conname,
      'type',con.contype,'definition',pg_get_constraintdef(con.oid,true)
    ) order by n.nspname,c.relname,con.conname),'[]'::jsonb)
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','agentdesk_private')
  ),
  'catalog_indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',schemaname,'table',tablename,'name',indexname,'definition',indexdef
    ) order by schemaname,tablename,indexname),'[]'::jsonb)
    from pg_indexes where schemaname in ('public','agentdesk_private')
  ),
  'catalog_policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,
      'roles',roles,'command',cmd,'using',qual,'check',with_check
    ) order by schemaname,tablename,policyname),'[]'::jsonb)
    from pg_policies where schemaname in ('public','agentdesk_private')
  ),
  'catalog_functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',n.nspname,'name',p.proname,
      'arguments',pg_get_function_identity_arguments(p.oid),
      'result',pg_get_function_result(p.oid),'security_definer',p.prosecdef,
      'settings',coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
      'owner',pg_get_userbyid(p.proowner)
    ) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','agentdesk_private')
  ),
  'catalog_grants', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'schema',table_schema,'table',table_name,'grantee',grantee,'privilege',privilege_type
    ) order by table_schema,table_name,grantee,privilege_type),'[]'::jsonb)
    from information_schema.role_table_grants
    where table_schema in ('public','agentdesk_private')
      and grantee in ('anon','authenticated','service_role')
  ),
  'catalog_default_acls', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'owner',owner.rolname,'schema',coalesce(n.nspname,''),'object_type',d.defaclobjtype,
      'acl',coalesce(d.defaclacl::text,'')
    ) order by owner.rolname,coalesce(n.nspname,''),d.defaclobjtype),'[]'::jsonb)
    from pg_default_acl d
    join pg_roles owner on owner.oid=d.defaclrole
    left join pg_namespace n on n.oid=d.defaclnamespace
    where n.nspname is null or n.nspname in ('public','agentdesk_private')
  )
) as production_preflight;

select (to_regclass('supabase_migrations.schema_migrations') is not null)::text
  as migration_ledger_present \gset
\if :migration_ledger_present
select coalesce(jsonb_agg(version::text order by version::text),'[]'::jsonb)
  as migration_ledger_versions
from supabase_migrations.schema_migrations;
\else
select '[]'::jsonb as migration_ledger_versions;
\endif

rollback;
