# Billing migration staging and recovery runbook

This runbook is for a separately approved, non-production Supabase project. Never point these steps at the AgentDesk AI production project (`cdynahtkwtcinjzmxjcs`). Paid checkout must remain disabled throughout validation.

## Preconditions

- Use a dedicated staging project with synthetic users and no production data.
- Confirm the selected project reference is not the production reference above.
- Store staging credentials only in the operator's secret manager or temporary shell environment; never add them to this repository or `.env.local`.
- Install the Supabase CLI outside the application dependency tree and authenticate interactively.
- Confirm the staging PostgreSQL version and required built-ins: PL/pgSQL, `gen_random_uuid`, advisory locks, RLS, `auth.users`, and `auth.uid()`.
- For a brand-new synthetic environment, bootstrap explicitly from
  `supabase/baselines/staging_baseline.sql`, then apply runnable migrations in
  filename order. The baseline is intentionally outside
  `supabase/migrations` and must never be copied back or treated as a
  production migration.

The baseline supplies the original tables and native
`reserve_ai_usage`/`release_ai_usage` functions only for a new empty synthetic
environment. Existing environments must begin with their next unapplied layer
instead of replaying the baseline.

## Production audit reconciliation (2026-10-16)

The read-only audit verified PostgreSQL 17.11 on production project
`cdynahtkwtcinjzmxjcs`; staging remains `koqlnjctqeaykhbqkyuj`. The production
migration ledger relation is absent, while catalog evidence shows these four
layers are already schema-equivalent:

1. `20261007000000_add_agent_allowed_domains.sql`
2. `20261007010000_security_hardening.sql`
3. `20261009000000_subscription_billing.sql`
4. `20261010000000_knowledge_attachments.sql`

These four layers remain pending and must be rehearsed in this exact order:

1. `20261011000000_super_admin.sql`
2. `20261012000000_leads_appointments.sql`
3. `20261013000000_marketing_consent.sql`
4. `20261014000000_trial_recurring_payment_methods.sql`

Do not infer an empty database from the absent ledger. Before any production
change, obtain an approved encrypted logical backup and successful isolated
restore. In the isolated rehearsal only, adopt the four schema-equivalent
versions into the ledger, confirm discovery shows exactly the four pending
versions, and then apply the pending files one at a time. Production ledger
adoption and migration execution each require separate approval.

## Staging backup

Before migration, create both artifacts below and record their checksums outside the repository:

1. A schema-only dump of the staging database.
2. A data-only dump containing synthetic staging rows.

Verify that the dump command targets the staging project reference. Inspect the dump header and reject it if it names production. Do not copy real customer data into staging.

## Migration rehearsal

1. Record the migration history and row counts for `usage_limits` and all customer-owned tables.
2. Rehearse ledger adoption as described above, then apply the four genuinely
   pending migrations in strict order through the staging migration mechanism.
3. Run the verification queries for tables, constraints, indexes, foreign keys, forced RLS, grants, policies, and function execution privileges.
4. Create two synthetic authenticated users. Verify cross-account reads and all browser writes to private billing tables fail.
5. Run `AGENTDESK_PGLITE_ROOT=<temporary-runtime> npm test` locally and run the staging SQL regression suite separately.
6. Test idempotency only where a migration explicitly supports it; do not
   blindly reapply the whole sequence. Confirm plan configuration and
   subscription records are unchanged after the supported check.

## Recovery rehearsal

Prefer restoring into a second empty, isolated staging database rather than overwriting the first rehearsal database.

1. Create the empty recovery database with the same PostgreSQL major version.
2. Restore roles, revoke default table privileges from `public` and from
   `anon`/`authenticated` when those roles exist, then restore schema and
   synthetic data.
3. Reapply any migration versions created after the backup.
4. Compare subscription, usage, billing-event, and payment-transaction counts and stable identifiers.
5. Verify provider event and transaction uniqueness constraints.
6. Replay one already-processed synthetic webhook and require `duplicate: true` with no new rows.
7. Run authenticated, anonymous, cross-account, quota, expiration, and cancellation checks again.
8. Keep the original staging database until the restored database passes every check.

## Production gate

Production migration requires a separate explicit approval. Before that approval, attach the staging project reference, database version, migration output, verification results, backup checksums, restore results, and a reviewed maintenance/rollback decision. A browser redirect must never activate a paid plan; only a signature-verified, idempotently reconciled provider webhook may do so.
