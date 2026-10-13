# Production billing migration backup and recovery plan

This is a planning document only. It does not authorize a production dump,
restore, migration, settings change, or purchase. Production project reference:
`cdynahtkwtcinjzmxjcs`. The staging-only baseline migration must never be
applied to production.

## Observed preflight facts (2026-10-09)

- PostgreSQL: 17.11.
- Catalog-reported database size: 11,998,899 bytes (about 11.44 MiB).
- `pgcrypto`, `plpgsql`, and `uuid-ossp` are installed.
- The billing relations are absent; existing AgentDesk relations and required
  usage RPCs are present.
- The optional `supabase_migrations.schema_migrations` ledger relation is absent.
- No customer rows were selected, counted, exported, or copied to obtain these
  facts.

## Free-plan limitation

Supabase does not provide downloadable managed backups for Free projects and
does not include daily managed recovery or PITR. A separately approved manual
logical export is therefore the production recovery prerequisite. It will read
and transfer customer data and must not be run until the owner approves its
destination, retention, encryption, and operators.

## Approved-window backup procedure

1. Freeze application writes for the short migration window, or explicitly
   accept that a logical dump is a consistent snapshot taken before later
   transactions. Record the UTC start time and deployed application commit.
2. In a private temporary directory outside the repository, set a shell-local
   `PROD_DB_URL` to the production **session pooler** connection string. Never
   echo it, add it to shell history, or save it in `.env`.
3. Verify the connection hostname and project reference contain
   `cdynahtkwtcinjzmxjcs`; abort on any mismatch.
4. With a reviewed Supabase CLI version, run:

   ```text
   supabase db dump --db-url "$PROD_DB_URL" -f roles.sql --role-only
   supabase db dump --db-url "$PROD_DB_URL" -f schema.sql
   supabase db dump --db-url "$PROD_DB_URL" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
   ```

5. Record SHA-256 checksums, encrypt the three files at rest, restrict access,
   and copy them to the separately approved recovery location. Do not commit
   them or upload them to an unapproved service.
6. Inspect only dump headers and schema metadata for target identity and errors;
   do not print data contents. Require non-empty artifacts and successful exit
   codes before proceeding.

The current database is small, but logical output varies with row contents and
indexes. Reserve at least 100 MiB for the initial encrypted artifact set and the
same amount for a second verified copy. Recalculate immediately before the
migration if the catalog size changes materially.

## Restore rehearsal and emergency recovery

Restore into a new, empty, isolated Supabase recovery project with the same
PostgreSQL major version. Never rehearse by overwriting production.

1. Confirm the recovery target project reference is not production.
2. Before schema restore, apply the privilege precaution recommended by
   Supabase so target default privileges do not broaden access:

   ```sql
   alter default privileges in schema public revoke all on tables from anon, authenticated;
   ```

3. Restore `roles.sql`, then `schema.sql`, then `data.sql` using the reviewed
   Supabase CLI/`psql` procedure and the recovery target connection only.
4. Run the read-only catalog preflight, verify RLS/grants/functions, and compare
   approved aggregate control totals and stable identifiers without exposing
   record contents.
5. Apply only migrations newer than the snapshot, in order. Do not apply
   `20261006000000_staging_baseline.sql` to an existing production-derived
   restore.
6. Run synthetic authentication, cross-account, quota, cancellation, webhook
   replay, and application smoke tests against the isolated recovery target.
7. Keep production unchanged until the restored target passes and an owner
   separately approves any cutover.

## Migration and rollback decision

The billing migration creates new tables, policies, indexes, and functions and
seeds three plan rows. It does not update existing customer rows during
migration. Foreign keys to `auth.users` can take short catalog/table locks;
schedule a quiet window and set reviewed `lock_timeout`/`statement_timeout`
values in the operator transaction.

If migration execution fails, roll back the whole transaction. After a
successful migration begins receiving billing events, do not use a blind
down-migration: dropping billing objects would destroy audit and payment
history. Prefer forward repair. A full restore is the last resort and has an
RPO equal to the age of the approved logical snapshot plus any separately
captured, reconciled events.
