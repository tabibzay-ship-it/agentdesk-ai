# AgentDesk AI backup and disaster recovery runbook

This runbook is preparation only. Production database/Storage access, backup
creation, destination writes, restore infrastructure, and every external copy
require separate approval.

## Required tools and inputs

- Reviewed Supabase CLI and PostgreSQL 17-compatible restore client.
- Pinned `age` v1.3.2 whose Windows archive hash matches the approved record.
- Two distinct native age recipients with identities held by separate
  custodians on access-controlled encrypted devices.
- A password-free session-pooler URL supplied process-locally and the database
  password supplied only to the backup process. Never log either value.
- A reviewed managed-schema customization artifact and a reviewed Storage
  adapter implementing paginated bucket/object listing plus streaming reads.
- Exact application commit, database version, maintenance decision, retention
  period, operators, and two healthy independent destinations.

## Complete v2 set

The set is incomplete unless it contains encrypted roles, schema, data,
migration-history schema/data, managed-schema customizations, every required
Storage object, `manifest.json`, `SHA256SUMS.txt`, and an atomically published
`BACKUP_COMPLETE` marker. `BACKUP_INCOMPLETE` or any mismatch fails closed.

The manifest records the backup/project identifiers, UTC timestamps, database
version, application commit, component coverage, encrypted sizes and hashes,
Storage buckets/object paths/counts/metadata/hashes, dependencies, and status.
Signed URLs, credentials, tokens, recovery identities, and customer content
must never appear in it.

## Approved execution sequence

1. Reconfirm project `cdynahtkwtcinjzmxjcs`, approved window, operators,
   retention, free space, device identity, and healthy independent storage.
2. Independently test both age identities with synthetic ciphertext.
3. Capture roles, application schema/data, migration ledger, and reviewed
   managed-schema customizations into encrypted streams.
4. Enumerate Storage with stable pagination. Encrypt each object while reading;
   preserve exact logical paths only in the encrypted set's manifest. Reject
   duplicates, size changes, non-advancing cursors, and inventory drift.
5. Validate every ciphertext hash, decrypt-and-hash with each identity, validate
   the complete manifest, then publish `BACKUP_COMPLETE` last.
6. Copy only the verified encrypted set to the independent destination and
   verify it again. Never use damaged media or assume partitions are independent.

## Isolated recovery rehearsal

Use a disposable target with no public ports or outbound integrations. A plain
PostgreSQL container proves only generic SQL portability; full recovery needs a
Supabase-compatible target for Auth, Storage, managed roles, Realtime, and
platform behavior. Disable SMTP, webhooks, payments, paid AI, OAuth callbacks,
and all real external credentials before restore.

Restore roles, schema, managed customizations, migration history, and data with
fail-fast transactions. Stream-decrypt Storage objects to a private disposable
bucket, verify plaintext hashes, reconcile metadata/object counts, and then
verify tables, functions, triggers, indexes, RLS, effective grants, Auth
dependencies, attachment integrity, billing/credit aggregates, synthetic
two-account isolation, webhook replay, reservation/settlement/refund behavior,
and application compatibility. Never use customer content as test output.

Logical data import may use `session_replication_role=replica` only as a
process-local setting on the isolated restore connection. This prevents restored
rows from firing audit or side-effect triggers a second time; it must never be
set globally or against production. The restore fails closed unless a fresh
validation connection reports `session_replication_role=origin`, every foreign
key is validated and enforced, and representative triggers fire normally after
the import.

## Failure and rollback

Leave a failed run marked `BACKUP_INCOMPLETE`; never promote or merge partial
sets. Do not overwrite a prior valid set. Abort a partial Storage upload and
retain diagnostic metadata only under the approved retention rule. A failed
restore is discarded with its disposable target; it never writes back to
production. Production cutover or migration requires a separate decision after
both independent identities have reproduced a verified recovery.

## Production approval checklist

- Production database and private Storage read authorization.
- Exact timestamped primary and independent destinations.
- Two approved recipients/custodians and offline recovery-key custody.
- Approved managed-schema capture and Storage adapters.
- Maintenance consistency, retention/deletion, and incident owners.
- Isolated Supabase-compatible restore target and external-integration shutdown.
- Explicit approval for any later migration, deployment, or cutover.
