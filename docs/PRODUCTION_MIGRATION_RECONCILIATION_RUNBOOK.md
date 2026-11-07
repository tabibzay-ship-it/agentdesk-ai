# Production migration reconciliation runbook

Status: **NO-GO for production execution without a separate explicit approval**.

This runbook applies only to AgentDesk AI production project
`cdynahtkwtcinjzmxjcs`. It documents the evidence and controls needed for a
future migration window; it does not authorize a production write, migration,
ledger repair, deployment, or payment activation.

## Verified recovery baseline

- Encrypted backup ID: `20261106-221235Z`
- Ciphertext SHA-256:
  `44B2E201BBD7275407081685463783995F7686835F4313C91EE5A829EF963F1B`
- Plaintext archive SHA-256 (hash only; no plaintext archive persisted):
  `481D67295F0618E28A99A8AD2B7B3C8E220FE836DB9B550C5D899966FF84672F8`
- Recovery Identity A: independently verified
- Recovery Identity B: independently verified
- RAM-only isolated restore: PASS
- Restore image:
  `public.ecr.aws/supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc`
- Restore isolation: no network, no Docker logging, no host mounts, no
  persistent volumes, and plaintext confined to tmpfs.
- Restore limitation: disposable grantor provenance was normalized and the
  archive was restored without exact ownership parity. Do not treat the clone
  as proof of exact managed-role ownership recovery.

## Approved LF migration hashes

The operator must compute LF-normalized SHA-256 immediately before a future
production window and require exact equality with this list:

| Migration | LF SHA-256 |
|---|---|
| `20261006000000_initial_application_schema.sql` | `4D9A4B81354E11A3BEBF4838E1D66FE5E9E629D27054AE79E3089C45373A7C82` |
| `20261007000000_add_agent_allowed_domains.sql` | `ED0491002406C8854650BFD8C05ACB4A8D5C2EBD417D34FA63F472B5F4E1E926` |
| `20261007010000_security_hardening.sql` | `ED1A69BADC675AEE76C3518924C42424409E72A7807DCDECE9DC8CFBCF7679E6` |
| `20261009000000_subscription_billing.sql` | `8921FAD60BBAE5B2E0BD4EEDF108BA5A469470B841F9523E9A466134ABDD5FE5` |
| `20261010000000_chat_attachments.sql` | `88B987219B9351DC519A8CF94FBA22048F7B7472B90AC7B2C272D85861AD87A6` |
| `20261011000000_super_admin.sql` | `7B003E2C5D4EE41BBFE7656A5F8FC33AAFF73D1C36A38D107E012FEF05B341CB` |
| `20261012000000_leads_appointments.sql` | `1D771A1782DFEC70418320DEBEFA45D2769CEEB042F7E9DE3A7D2035FD32C852` |
| `20261013000000_marketing_consent.sql` | `3B58C3CA894941C9C84986324378B93C1CE98ACE78D14C8A64F7583B39806597` |
| `20261014000000_trial_recurring_payment_methods.sql` | `612A1F2D616318823A2943EC28548A37CCAEFAC137DF11F3C38F5E8E65D41360` |
| `20261015000000_conversation_history.sql` | `BF8B10CE535ED3AACD7E59D5B0310F97073A5784DD16774991101D16ABFB652F` |
| `20261016000000_chat_request_idempotency.sql` | `A3A5B2F2E0C3F9F40C39C9CBCA53651931DB09107B0EBD9490BF13150041A72D` |
| `20261017000000_ai_credit_controls.sql` | `FB74CDA86EDB256B3F03FADE35C54003BBE2164761EA05E401099C3DD1DA1988` |
| `20261018000000_nowpayments.sql` | `0697ECA13519E42DA3CC7F6BD32745A10D8576B7F66796737433D425196B92E7` |

## Reconciliation decision

The production migration ledger is absent. Catalog sentinels in the restored
production clone prove that the first five migration layers are currently
schema-equivalent. They do **not** prove the historical files were executed.

Classify the first five as:

- schema state: **EQUIVALENT**
- migration history: **AMBIGUOUS — LEDGER ABSENT**
- action: **DO NOT EXECUTE AGAINST PRODUCTION**

The following eight layers were absent from the production preflight and each
passed first application and supported second application in the disposable
clone:

1. `20261011000000_super_admin.sql`
2. `20261012000000_leads_appointments.sql`
3. `20261013000000_marketing_consent.sql`
4. `20261014000000_trial_recurring_payment_methods.sql`
5. `20261015000000_conversation_history.sql`
6. `20261016000000_chat_request_idempotency.sql`
7. `20261017000000_ai_credit_controls.sql`
8. `20261018000000_nowpayments.sql`

The rehearsal preserved existing rows. Aggregate rows increased from 363 to
369 only because migrations created configuration/system seed rows. It also
verified 18 policies, AI-credit tables, the private AI ledger, NOWPayments
orders and IPN function. The rehearsed defaults were `provider_enabled=true`
and `emergency_shutdown=false`; those defaults are **not approval to activate
paid AI or live payments**. Before application traffic can use AI, a separate
operational decision must set a safe production posture.

## Mandatory pre-window gates

1. Obtain separate explicit approval for both production ledger reconciliation
   and the eight production migrations.
2. Keep production publishing locked and live payments/external AI disabled.
3. Re-run the bounded production read-only preflight with TLS verify-full.
4. Require the exact production project reference and reject every other ref.
5. Re-verify all 13 LF hashes and compare every first-five schema sentinel.
6. Stop on any schema drift, changed hash, missing backup, failed recovery
   identity, or failed restore evidence.
7. Confirm both recovery custodians can retrieve their passphrases.
8. Record privacy-preserving pre-migration counts and current Auth/service
   health. Do not export customer records into logs.
9. Schedule an owner-attended maintenance window with a tested abort path.

## Ledger baseline policy

Do not fabricate history and do not replay the first five files. A baseline is
permitted only after a fresh catalog-equivalence report passes and a separate
review approves the exact ledger operation.

Use a supported Supabase migration-history repair mechanism or a reviewed,
single-purpose SQL transaction. The operation must record only the five
schema-equivalent versions, must not execute their SQL, and must verify the
result before commit. Never rely on a repository or CLI project link to select
production; use the explicitly verified TLS connection and project guard.

If a supported, auditable baseline cannot be established, stop. Do not apply
the eight migrations with an untracked history.

## Future execution sequence

After all gates and separate approval:

1. Establish the five-version baseline in one reviewed transaction.
2. Apply each pending file in the order listed above, one file per transaction.
3. Use a short lock timeout and a bounded statement timeout.
4. Stop immediately on the first error or unexpected notice; do not skip ahead.
5. Record a migration version only in the same successful unit of work as its
   migration, or through the supported migration runner's atomic behavior.
6. Do not manually insert later versions after a failed migration.
7. Keep NOWPayments disabled and do not enable external AI during migration.

## Post-migration verification

Require all of the following before considering a later deployment:

- exactly 13 approved migration versions in chronological order;
- expected tables, columns, constraints, indexes, functions, triggers,
  policies, grants, storage configuration, and RLS state;
- unchanged identifiers and counts for all pre-existing customer rows;
- tenant-isolation and privileged-role tests;
- AI-credit configuration and emergency-shutdown inspection;
- NOWPayments order/IPN uniqueness and signature/idempotency tests with
  synthetic data only;
- TypeScript, ESLint, security, full tests, and production build PASS;
- a new encrypted post-migration backup and isolated restore rehearsal under a
  separately approved export.

## Abort and recovery

- Before commit: let the current migration transaction roll back.
- After a committed migration: stop; keep publishing locked; diagnose from the
  recorded version and catalog evidence. Prefer a reviewed forward fix.
- Do not execute an improvised destructive down migration.
- For unrecoverable schema/data damage, restore into a new isolated project or
  use an available provider point-in-time recovery facility. Never overwrite
  the current production database without a separate disaster-recovery
  authorization and a verified cutover plan.
- The current encrypted logical backup is a verified recovery artifact, but its
  ownership/grantor normalization limitation must be addressed in any actual
  managed-project recovery procedure.

## Current decision

- Disposable eight-migration rehearsal: **PASS**
- First-five schema equivalence: **PASS**
- First-five historical proof: **BLOCKED (ledger absent)**
- Production migration execution: **NO-GO pending explicit approval and an
  approved ledger-baseline operation**
- Production deployment: **NO-GO**
