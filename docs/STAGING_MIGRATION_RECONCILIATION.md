# Staging migration reconciliation plan

Target: `koqlnjctqeaykhbqkyuj` (staging only). The production reference
`cdynahtkwtcinjzmxjcs` is forbidden. This document does not authorize a remote
connection, ledger write, schema change, or migration.

## Fixed migration order

1. `20261006000000_initial_application_schema.sql`
2. `20261007000000_add_agent_allowed_domains.sql`
3. `20261007010000_security_hardening.sql`
4. `20261009000000_subscription_billing.sql`
5. `20261010000000_chat_attachments.sql`
6. `20261011000000_super_admin.sql`
7. `20261012000000_leads_appointments.sql`
8. `20261013000000_marketing_consent.sql`
9. `20261014000000_trial_recurring_payment_methods.sql`
10. `20261015000000_conversation_history.sql`
11. `20261016000000_chat_request_idempotency.sql`
12. `20261017000000_ai_credit_controls.sql`
13. `20261018000000_nowpayments.sql`

## Read-only inventory

1. Verify the hostname and user contain the staging reference and reject the
   production reference before requesting a password.
2. Start `BEGIN READ ONLY`, set short statement and lock timeouts, then record
   server version, current database, current user, and transaction read-only
   state.
3. Read the migration ledger. An empty or missing ledger is **not** evidence of
   an empty schema.
4. Inventory tables, columns, constraints, indexes, functions, triggers, RLS,
   policies, ownership, and effective grants in `public`, `auth`, and `storage`.
5. Collect aggregate row counts only. Do not print customer rows or Auth data.
6. Roll back the read-only transaction.

Use `supabase/staging-readonly-preflight.sql` for the bounded first-pass query.

## Classification rules

For every local migration, assign exactly one result:

- **LEDGER_AND_OBJECTS**: ledger version and all expected objects exist.
- **OBJECTS_ONLY**: expected objects exist but the ledger version is absent.
- **LEDGER_ONLY**: ledger version exists but required objects are absent.
- **PARTIAL_OR_CONFLICTING**: only some objects exist or definitions differ.
- **PENDING**: neither ledger entry nor expected objects exist.

Never insert a baseline ledger row solely because similarly named objects exist.
For OBJECTS_ONLY, compare normalized definitions, constraints, policies, grants,
function signatures, and indexes with a disposable PostgreSQL 17 rehearsal first.
LEDGER_ONLY and PARTIAL_OR_CONFLICTING are blockers requiring a reviewed repair
migration; do not replay migrations speculatively.

## Backup gate and execution gate

No staging migration may run until an age-encrypted, two-recipient backup has
been independently decrypted and restored. Because secure independent custody
is currently unavailable, this gate is BLOCKED.

After the gate clears, prepare one reviewed action list containing exact migration
filenames and SHA-256 values, expected changes, transaction boundaries, timeouts,
verification queries, and rollback checkpoints. Obtain separate approval before
any remote write.

## Rollback

- Stop at the first failed prerequisite or verification.
- Roll back the current transaction; never edit the ledger to hide a failure.
- Keep NOWPayments disabled and leave the Deploy Preview unpublished or disabled.
- Restore only into a new disposable database for diagnosis. Never overwrite
  staging until a separately reviewed recovery decision is approved.
