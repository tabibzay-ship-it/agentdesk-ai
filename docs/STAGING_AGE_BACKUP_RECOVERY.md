# Staging age backup and recovery

## Trust and tool verification

Use only the official `FiloSottile/age` v1.3.2 Windows amd64 release archive.
Its required SHA-256 is
`F48D8F8F9EBE903AB5027ED067652F2CC1DB94BC206976430133B905DCD8E8C7`.
The release provides a Sigsum proof. Verify that proof with the age project's
published Sigsum keys before operational use when an approved verifier is
available. The Windows executables are not Authenticode-signed on this machine.

## Two-recipient custody

Two independent recovery identities have been generated and passphrase-encrypted
outside the repository. Identity A is held on the approved USB custody drive;
Identity B is held in OneDrive custody, and its independently downloaded cloud
copy was hash-verified. Each encrypted identity independently decrypted the
same disposable test artifact. The two distinct passphrases were recovered
from the owner's OneDrive-independent password manager during verification.

Never place either encrypted identity, either passphrase, or a decrypted private
identity in Git, an environment file, command history, logs, or the backup
destination. Use only the public `age1...` recipients from the locally protected
public state file. Do not regenerate or overwrite the verified identities.

## Streaming backup

Validate the exact staging session-pooler host and the
`postgres.koqlnjctqeaykhbqkyuj` username before prompting for its password.
Run a TLS `verify-full`, read-only identity query with the fingerprint-pinned
Supabase Root 2021 CA. Do not use the operating-system trust store as a
substitute. Then stream each producer directly into age; do not use an
intermediate plaintext file:

```text
pg_dump --format=custom ... stdout
  -> age --encrypt --recipient A --recipient B --output database.dump.age -

pg_dump --schema-only --format=plain ... stdout
  -> age --encrypt --recipient A --recipient B --output schema.sql.age -
```

Pass `PGPASSWORD` only to the `pg_dump` child process. Clear its in-memory value
after the child exits. The age process must not inherit database credentials.

The prepared operational entry point is
`scripts/backup/Invoke-StagingAgeBackup.ps1`. It requires exactly two public
recipients and both separately held recovery identities for independent
verification. The former EFS entry point is disabled and exits immediately.

The staging password remains an external prerequisite. Do not run the backup
until the staging password rotation is completed, Supavisor propagation has
settled, and `Test-StagingReadOnlyIdentity.ps1` proves the session is PostgreSQL
17, read-only, and scoped to the expected staging schema and migration ledger.

## Integrity and restore validation

Record SHA-256 for every ciphertext file and the streaming plaintext hash in a
manifest containing no credentials or row data. Validate ciphertext hashes
before decryption. Independently decrypt with recipient A and recipient B and
require both plaintext hashes to match the streaming hash.

For an isolated restore, start a disposable PostgreSQL 17 server bound only to
`127.0.0.1`, create an empty disposable database, and stream directly:

```text
age --decrypt --identity offline-test-copy database.dump.age stdout
  -> pg_restore --exit-on-error --no-owner --no-privileges ... stdin
```

Compare aggregate table counts, indexes, functions, RLS policies, grants, and
migration ledger rows. Do not output customer rows. Stop the disposable server
and remove only its task-specific temporary data after verification.

## Limitations

- Losing both private identities makes the backup unrecoverable.
- Compromise of either identity permits decryption, because each recipient can
  recover independently.
- Ciphertext SHA-256 proves file integrity, not completeness of the source read.
- A successful `pg_restore --list` proves archive readability, not semantic
  recovery; the isolated restore and aggregate comparisons remain mandatory.
- Sigsum verification remains a production-readiness gate if its verifier is
  unavailable locally.
