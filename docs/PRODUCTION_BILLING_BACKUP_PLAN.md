# Production billing migration backup and recovery plan

This is a planning document only. It does not authorize a production dump,
restore, migration, settings change, or purchase. Production project reference:
`cdynahtkwtcinjzmxjcs`. The staging-only baseline migration must never be
applied to production.

## Observed preflight facts (2026-10-16)

- The inspected project was `cdynahtkwtcinjzmxjcs` (`agentdesk-ai`), region
  `ap-northeast-1`, and reported `ACTIVE_HEALTHY`. The staging project
  `koqlnjctqeaykhbqkyuj` is separate.
- PostgreSQL: 17.11. Catalog-reported database size: 12,605,107 bytes.
- `pgcrypto`, `plpgsql`, and `uuid-ossp` are installed.
- `supabase_migrations.schema_migrations` is absent (not merely empty and not
  an access-denied result).
- Live schema is equivalent to four local migration layers:
  `20261007000000`, `20261007010000`, `20261009000000`, and
  `20261010000000`.
- Four later layers are genuinely pending: `20261011000000`,
  `20261012000000`, `20261013000000`, and `20261014000000`.
- The staging baseline is non-runnable at
  `supabase/baselines/staging_baseline.sql`; normal migration discovery cannot
  select it.
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

5. Separately capture the migration-history schema/data and reviewed custom
   triggers, policies, and functions on Supabase-managed `auth`/`storage`
   schemas. A standard schema dump must not be represented as covering these.
6. Enumerate every Storage bucket and object with pagination, stream each
   object into encryption, preserve bucket/path/size/metadata, and record both
   plaintext-stream and ciphertext SHA-256 hashes. Re-enumerate before marking
   the inventory stable.
7. Stream each dump directly to age with two distinct public recipients; never
   create plaintext production SQL. Record SHA-256 checksums of ciphertext.
   A set is usable only when `BACKUP_COMPLETE` exists, `BACKUP_INCOMPLETE` does
   not exist, metadata status is `complete`, and all three encrypted artifacts
   pass checksum and decryption-stream verification. Quarantine every other
   set; never resume or overwrite it.
8. Inspect only dump headers and schema metadata for target identity and errors;
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
2. Restore `roles.sql`, then apply the privilege precaution before schema
   restore. Revoke from `public`, and conditionally from `anon` and
   `authenticated` only after those roles exist:

   ```sql
   alter default privileges in schema public revoke all on tables from public;
   -- Also revoke from anon/authenticated when each role exists.
   ```

3. Restore `schema.sql`, then `data.sql` using the reviewed
   Supabase CLI/`psql` procedure and the recovery target connection only.
4. Run the read-only catalog preflight, verify RLS/grants/functions, and compare
   approved aggregate control totals and stable identifiers without exposing
   record contents.
5. Rehearse ledger adoption before pending migrations. On an isolated clone,
   mark only the four schema-equivalent versions (`20261007000000`,
   `20261007010000`, `20261009000000`, `20261010000000`) as applied, verify
   that discovery reports exactly the four pending versions, then rehearse them
   in strict order: super admin, CRM/widget columns, marketing consent, and
   trial/recurring payment methods. Do not use `db push` or any migration
   repair operation against production without separate approval.
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

## Prepared zero-cost encrypted workflow (2026-10-13)

The local preparation scripts are in `scripts/backup/`. They are preparation
tools and do not authorize production access.

- `Test-ProductionConnectionTarget.ps1` validates the session-pooler URL and
  production project reference without opening a network connection.
- `New-EncryptedProductionBackup.ps1` requires an explicit approval switch,
  PowerShell confirmation, an existing destination outside the repository,
  two independently stored age recipients, and a password-free `PROD_DB_URL`
  plus process-local `PGPASSWORD`. Each
  Supabase dump is streamed directly into recipient-based `age` encryption;
  plaintext production SQL is never written to disk.
- `Test-EncryptedBackup.ps1` verifies encrypted SHA-256 checksums and hashes
  decrypted streams without creating plaintext files.
- `Restore-IsolatedBackup.ps1` accepts only a specially named Docker container
  whose network mode is exactly `none`, and streams decrypted SQL directly to
  its local `psql` process.
- `Invoke-ReadOnlyRecoveryValidation.ps1` runs the catalog validation only in
  a network-isolated recovery container.
- `Clear-BackupWorkingSet.ps1` is restricted to a specific child of the OS
  temporary directory. It warns that ordinary deletion cannot guarantee SSD
  block sanitization.

The pinned local encryption tool is age v1.3.2 from the official
`FiloSottile/age` GitHub release. The Windows AMD64 archive must match SHA-256
`f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7`.
The tool is stored under the ignored `.tools/` directory and is not added to
the system PATH.

After separate key-generation approval, create two independent age identities:
one operator identity and one offline recovery identity. Store each identity on
a different access-controlled encrypted device, never in the repository or the
backup directory. Derive their public recipients with `age-keygen -y`, retain
only those public recipient strings in the operating procedure, and encrypt
every backup to both recipients. Before production use, test both identities
independently against synthetic ciphertext, verify the decrypted stream hash,
and document the custodians. Loss of every identity makes the backup
irrecoverable; disclosure of any identity exposes every backup encrypted to it.

Historical drive-letter observations are not current destination approval.
`F:` is unreliable and must not be used. Neither `C:`/`D:` drive letters nor
two folders prove independent physical storage. A future operation must verify
physical device identity and health, choose one primary encrypted destination
and one different healthy physical/off-site destination, and create a new UTC
child without overwriting anything. Recovery identities must not be stored on
either backup destination.

Production execution remains blocked until the owner approves all of the
following: the exact primary and second-copy destinations, two age recipients
whose private identities are stored on separate encrypted devices, the offline
passphrase/escrow process described in `docs/AGE_BACKUP_KEY_PROCEDURE.md`,
retention and deletion policy,
authorized operators, a maintenance-consistency decision, and one specific
production backup window. The age identity must never be stored beside the
encrypted backup or committed to this repository.

An official PostgreSQL 17.11 Alpine container is suitable for portable logical
restore testing. A plain PostgreSQL image does not reproduce Supabase-managed
roles, `auth`, `storage`, Realtime, Vault, or platform extensions. A full
Supabase-faithful rehearsal therefore requires the locally hosted Supabase
stack or a separately approved non-production Supabase project. No paid
project is required for the basic logical integrity test.
