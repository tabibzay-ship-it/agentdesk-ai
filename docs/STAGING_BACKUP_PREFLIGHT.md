# Staging backup credential and recovery preflight

This workflow is only for `agentdesk-ai-staging`, project reference
`koqlnjctqeaykhbqkyuj`. Production project `cdynahtkwtcinjzmxjcs` is forbidden.

## Credential entry

Copy the session-pooler URL from the staging dashboard, remove its password, and
ensure it ends with `postgres?sslmode=require`. Never put the password in a
command, URL, `.env`, PowerShell history, Git, a log, or chat. First validate the
target without opening a network connection:

```powershell
& '.\scripts\backup\Prepare-StagingBackupCredential.ps1' `
  -DatabaseUrl 'postgresql://postgres.koqlnjctqeaykhbqkyuj@<staging-session-pooler-host>:5432/postgres?sslmode=require' `
  -ValidateTargetOnly
```

After this reports the exact staging reference, run it again without
`-ValidateTargetOnly`. PowerShell displays a hidden password prompt. The script
checks secure input and discards it; it does not connect or create a backup.

## PostgreSQL 17 compatibility

Use PostgreSQL 17 `pg_dump`, `pg_restore`, `pg_dumpall`, and `psql`. The project
config requires PostgreSQL 17. These clients are not currently on PATH, so a
later backup must use a verified local PostgreSQL 17 client bundle or a separately
approved disposable PostgreSQL 17 container. Never install tooling implicitly.

The preferred Windows package is EDB's portable x64 archive linked from the
official PostgreSQL Windows download page:

- File: `postgresql-17.11-5-windows-x64-binaries.zip`
- HTTPS source: `https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip`
- EDB checksum endpoint: the same URL with `.sha256` appended
- Approved SHA-256: `80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`

The archive is portable and must be extracted into a new isolated tools folder;
do not run the installer and do not change the system or user PATH. EDB publishes
the archive checksum, but the individual client executables are not guaranteed
to carry Authenticode signatures. Treat an exact checksum match as mandatory and
stop if it does not match.

After a separately approved download and extraction, validate the archive and
clients without connecting to a database:

```powershell
& '.\scripts\backup\Test-Postgres17PortableTools.ps1' `
  -ArchivePath '<downloaded-zip>' `
  -ToolRoot '<isolated-folder>\pgsql'
```

Require database `postgres`, user `postgres.koqlnjctqeaykhbqkyuj`, the staging
session pooler, and `sslmode=require`. Record each client version before backup.

## Separately authorized backup and verification sequence

1. Revalidate the staging project reference and local migration hashes.
2. Prompt with `Read-Host -AsSecureString`. Convert only in memory and provide
   `PGPASSWORD` only to each database child process; never set a persistent
   user/machine variable or echo the command.
3. Create a new timestamped directory outside the repository; never overwrite an
   older backup.
4. Create `roles.sql`, `schema.sql`, `data.sql`, and custom-format
   `database.dump` with PostgreSQL 17 and `--no-owner`, including accessible
   `auth`, `public`, `storage`, and migration metadata.
5. Dispose of plaintext password memory immediately after dump processes exit.
6. Calculate SHA-256 with `Get-FileHash -Algorithm SHA256`. Store only filenames,
   sizes, hashes, project reference, PostgreSQL version, and UTC time in manifest.
7. Run `pg_restore --list database.dump`, verify all hashes, and reject empty or
   partial artifacts.
8. Restore into a new disposable PostgreSQL 17 instance with no published ports
   and Docker network mode `none`; never restore over staging or production.
9. Compare schema inventory, aggregate row counts, functions, indexes, RLS,
   grants, and migration ledger. Remove only the disposable resources afterward.

The read-only queries are in `supabase/staging-readonly-preflight.sql`. They begin
a read-only transaction, use short timeouts, return only aggregate Auth/Storage
counts, and roll back.

Compare ledger rows with the 13 ordered files in `supabase/migrations`. Classify
each as ledger-confirmed, object-equivalent, missing, or conflicting. Schema
similarity is not permission to edit the ledger or apply a migration.

