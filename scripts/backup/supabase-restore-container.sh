#!/bin/bash
set -euo pipefail
install -d -o postgres -g postgres -m 700 /var/lib/postgresql/data/pgdata
chown postgres:postgres /tmp
cat >/tmp/agentdesk-init.sh <<'INNER'
#!/bin/bash
set -euo pipefail
export PGDATA=/var/lib/postgresql/data/pgdata
initdb -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=reject --no-sync >/dev/null
pg_ctl -D "$PGDATA" -o "-c listen_addresses= -k /tmp" -w start >/dev/null
createdb -h /tmp -U postgres agentdesk_restore
roles=(anon authenticated service_role authenticator dashboard_user pgbouncer supabase_admin supabase_auth_admin supabase_storage_admin supabase_realtime_admin supabase_functions_admin supabase_read_only_user supabase_replication_admin supabase_etl_admin supabase_pooler_user supabase_pg_net_admin pgsodium_keyholder pgsodium_keyiduser pgsodium_keymaker)
for role in "${roles[@]}"; do
  if ! psql -h /tmp -U postgres -d agentdesk_restore -At -v ON_ERROR_STOP=1 -c "select 1 from pg_roles where rolname='$role'" | grep -qx 1; then
    psql -h /tmp -U postgres -d agentdesk_restore -v ON_ERROR_STOP=1 -c "create role \"$role\" nologin" >/dev/null
  fi
done
echo AGENTDESK_SUPABASE_RESTORE_READY
INNER
chown postgres:postgres /tmp/agentdesk-init.sh
chmod 700 /tmp/agentdesk-init.sh
su postgres /tmp/agentdesk-init.sh
exec sleep infinity
