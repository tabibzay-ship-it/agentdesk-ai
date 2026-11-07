# Phase 44 production migration approval package

Prepared: 2026-11-07 (Asia/Kabul)

This package is preparation only. Production project `cdynahtkwtcinjzmxjcs`
has not been changed. Production migration, ledger baseline, deployment,
external AI, and live payments remain unauthorized.

## Evidence summary

- Reviewed runbook commit `1b5864ff2dd787332cbbd19cc9396e803c66ccd0`
  was pushed by normal fast-forward to
  `codex/nowpayments-preview-isolation`.
- Encrypted backup `20261106-221235Z`: PASS.
- Ciphertext SHA-256:
  `44B2E201BBD7275407081685463783995F7686835F4313C91EE5A829EF963F1B`.
- RAM-only restore: PASS; network/logging/host mounts/persistent volumes were
  disabled and plaintext remained in tmpfs.
- Migration rehearsal evidence SHA-256:
  `D2B55588ECD61AD7D4647D48F52B033998808132876ADC4C21AEA3BB823E7A21`.
- Recovery A/B: independently verified.
- Current complete suite: 272 PASS, 0 FAIL, 0 SKIP.
- Secret scan: PASS (249 candidate files).

The backup was created after the production read-only preflight and restored
successfully. Freshness is adequate for the current planning evidence, but a
future write window must recheck production drift and decide whether a newer
encrypted backup is required before migration.

## First-five object reconciliation

The ledger is absent. The following catalog objects demonstrate current schema
equivalence, not historical execution:

1. Initial application schema
   - Relations: `business_profiles`, `knowledge_sources`, `agent_settings`,
     `widget_settings`, `conversations`, `messages`, `usage_limits`.
   - Ownership foreign keys/unique keys and the base conversation/knowledge
     indexes are present.
   - Native reserve/release functions and service-role-only execution are
     present.
   - Owner tables have RLS enabled.
2. Allowed domains
   - `agent_settings.allowed_domains` exists as `text[]`.
3. Security hardening
   - `agentdesk_private.chat_rate_buckets` and
     `agentdesk_private.ai_usage_reservations` exist.
   - Rate-limit and secure reserve/release functions exist.
   - Input-bound constraints, forced RLS, private-schema restrictions, and
     browser-role grant revocations are present.
4. Subscription billing
   - `subscription_plans`, `subscriptions`, `billing_events`, and
     `payment_transactions` exist with expected indexes and constraints.
   - Billing reconciliation/reservation functions exist.
   - Account read policies and service-only writes are present.
5. Chat attachments
   - `chat_attachments` and its three indexes exist with forced RLS and
     service-only access.
   - The private `chat-attachments` Storage bucket exists.

The detailed production catalog preflight recorded 15 application relations,
130 columns, 75 constraints, 34 indexes, 18 policies, 11 functions, 99 explicit
grants, six default ACL entries, and 23 ownership constraints. Any difference
in a new preflight makes the baseline **NO-GO**.

The exact guarded baseline operation is
`supabase/plans/production-ledger-baseline.sql`. It is outside migration
discovery, refuses an existing ledger, validates first-five sentinels, and
records exactly five versions without replaying their SQL. It must not be run
until the owner separately approves that exact operation and the selected
Supabase CLI ledger shape is revalidated.

## Eight pending migrations

Required order and approved LF SHA-256:

1. `20261011000000_super_admin.sql` —
   `7B003E2C5D4EE41BBFE7656A5F8FC33AAFF73D1C36A38D107E012FEF05B341CB`
2. `20261012000000_leads_appointments.sql` —
   `1D771A1782DFEC70418320DEBEFA45D2769CEEB042F7E9DE3A7D2035FD32C852`
3. `20261013000000_marketing_consent.sql` —
   `3B58C3CA894941C9C84986324378B93C1CE98ACE78D14C8A64F7583B39806597`
4. `20261014000000_trial_recurring_payment_methods.sql` —
   `612A1F2D616318823A2943EC28548A37CCAEFAC137DF11F3C38F5E8E65D41360`
5. `20261015000000_conversation_history.sql` —
   `BF8B10CE535ED3AACD7E59D5B0310F97073A5784DD16774991101D16ABFB652F`
6. `20261016000000_chat_request_idempotency.sql` —
   `A3A5B2F2E0C3F9F40C39C9CBCA53651931DB09107B0EBD9490BF13150041A72D`
7. `20261017000000_ai_credit_controls.sql` —
   `FB74CDA86EDB256B3F03FADE35C54003BBE2164761EA05E401099C3DD1DA1988`
8. `20261018000000_nowpayments.sql` —
   `0697ECA13519E42DA3CC7F6BD32745A10D8576B7F66796737433D425196B92E7`

Every file passed first and second application in the disposable restored
clone. Existing aggregate rows were preserved; system/config seed rows changed
the aggregate from 363 to 369.

### Mandatory execution preconditions

- separate owner approval naming the baseline SQL and all eight hashes;
- fresh TLS verify-full production preflight with no drift;
- verified production project/Session Pooler guard independent of any CLI link;
- deploy lock maintained, owner present, and an abort window scheduled;
- both recovery identities retrievable and backup/restore evidence intact;
- one migration per transaction, short lock timeout, bounded statement timeout,
  and immediate stop on the first error;
- version recorded atomically only after its corresponding file succeeds;
- no user provisioning, synthetic payment, or provider call during the window.

## Expected changes and material risks

- Super Admin adds private admin/audit objects; it does not provision an admin.
- CRM adds leads, follow-ups, appointments, availability, and widget columns.
- Marketing adds preferences/events and an Auth-user trigger. Trigger ownership
  and `auth.users` privilege compatibility are a high-value precheck.
- Trial/billing adds entitlements, identity claims, reservations, and sanitized
  payment-method metadata.
- Conversation history and request idempotency add durable private state.
- AI-credit controls add configuration, costs, reservations, ledger, and
  security-definer functions.
- NOWPayments adds a private order ledger and signed-IPN reconciliation RPC.

Risks include short catalog locks, managed-role/trigger ownership differences,
seed-row creation, absent historical ledger provenance, and the logical
backup's inability to prove exact managed-role ownership parity. A blind down
migration would risk audit/payment history and is prohibited.

## AI and payment fail-closed posture

The AI migration seeds `provider_enabled=true` and
`emergency_shutdown=false`. Therefore the future approved migration unit must,
before allowing application traffic, execute and verify:

```sql
update public.ai_credit_control_config
set provider_enabled=false, emergency_shutdown=true, updated_at=now(), updated_by=null
where id=true;
```

This safety update is part of the proposed migration window, not authorization
to execute it now. The application must also retain
`AGENTDESK_EXTERNAL_AI_DISABLED=true` or omit the paid provider secret.

NOWPayments schema alone cannot activate checkout. Production hosting must keep
`NOWPAYMENTS_ENABLED=false`; no live API/IPN credentials or external webhook
may be activated. After migration, verify both flags before unlocking any
deployment.

## Test discrepancy resolution

The earlier restricted run reported 213 PASS, five FAIL, and 39 SKIP:

- Five `installation-verification` failures were local loopback HTTP tests. The
  restricted runtime blocked their `127.0.0.1` test server, producing generic
  `FETCH_FAILED` outcomes before the assertions.
- Thirty-nine database tests explicitly skipped because
  `AGENTDESK_PGLITE_ROOT` was not configured. Categories included admin,
  billing, idempotency, RLS/security, marketing, migration order, and
  NOWPayments database behavior.

They were rerun with the existing disposable PGlite dependency and authorized
local loopback access: **272 PASS, 0 FAIL, 0 SKIP**. No application fix was
needed for those environment-only results.

## Rollback and recovery

- Before commit: transaction rollback; stop the sequence.
- After a committed layer: keep deployment locked, do not skip forward, compare
  the exact recorded version/catalog, and use a reviewed forward fix.
- Never drop billing, audit, AI-credit, or payment objects as an improvised
  rollback.
- For unrecoverable damage, restore into a new isolated target or use an
  available provider recovery mechanism, then perform a separately authorized
  cutover. Do not overwrite production in place.
- After successful migration, a separately approved new encrypted backup and
  isolated restore are required before deployment approval.

## GO/NO-GO criteria

Technical rehearsal: **GO**.

Production execution remains **NO-GO** until the owner explicitly approves:

1. `supabase/plans/production-ledger-baseline.sql` after fresh equivalence and
   CLI-ledger-shape review;
2. the eight ordered migration files at the exact hashes above;
3. the fail-closed AI update in the same maintenance window;
4. continued `NOWPAYMENTS_ENABLED=false`, deploy lock, and external-AI disable;
5. post-migration verification and a new recovery checkpoint.

Production deployment remains a separate **NO-GO** decision.
