begin read only;
set local statement_timeout = '10s';
set local lock_timeout = '2s';

select current_database() as database_name,
       current_user as database_role,
       current_setting('server_version') as server_version,
       current_setting('transaction_read_only') as transaction_read_only;

select version from supabase_migrations.schema_migrations order by version;

select n.nspname as schema_name,
       count(*) filter (where c.relkind in ('r','p'))::integer as table_count,
       count(*) filter (where c.relkind = 'i')::integer as index_count
from pg_namespace n
left join pg_class c on c.relnamespace = n.oid
where n.nspname in ('auth','public','storage','supabase_migrations')
group by n.nspname order by n.nspname;

select schemaname, tablename, policyname, permissive, roles, cmd
from pg_policies where schemaname in ('public','storage')
order by schemaname, tablename, policyname;

select table_schema, table_name, privilege_type, grantee
from information_schema.role_table_grants
where table_schema in ('public','storage')
  and grantee in ('anon','authenticated','service_role')
order by table_schema, table_name, grantee, privilege_type;

select count(*)::bigint as auth_user_count from auth.users;
select count(*)::bigint as storage_object_count from storage.objects;

rollback;

