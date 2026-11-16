#!/bin/bash
set -euo pipefail
install -d -o postgres -g postgres -m 700 /var/lib/postgresql/data/pgdata
chown postgres:postgres /tmp
cat >/tmp/agentdesk-owner-init.sh <<'INNER'
#!/bin/bash
set -euo pipefail
export PGDATA=/var/lib/postgresql/data/pgdata
initdb -D "$PGDATA" --username=agentdesk_bootstrap --auth-local=trust --auth-host=reject --no-sync >/dev/null
pg_ctl -D "$PGDATA" -o "-c listen_addresses= -k /tmp" -w start >/dev/null
echo AGENTDESK_OWNER_RESTORE_READY
INNER
chown postgres:postgres /tmp/agentdesk-owner-init.sh
chmod 700 /tmp/agentdesk-owner-init.sh
su postgres /tmp/agentdesk-owner-init.sh
exec sleep infinity
