# Staging migration reconciliation evidence — 2026-10-28

Target: `koqlnjctqeaykhbqkyuj` (staging only). Production project
`cdynahtkwtcinjzmxjcs` is forbidden. This document does not authorize a remote
write, migration, ledger repair, deploy, webhook, or payment.

## Recovery and rehearsal evidence

- Owner-preserving encrypted backup: `20261028-143641Z`
- Independent Recovery A/B: PASS
- Supabase PostgreSQL 17.11 isolated restore: PASS
- Restored source comparison: 46 tables, 158 indexes, 31 functions, 18 RLS
  policies, 88 ownership records, and 1,240 ACL records; zero differences.
- Disposable migration clone: network `none`, no persistent volume.
- All 13 migrations: first execution PASS, second execution PASS, idempotency
  PASS.
- Existing-table data preservation: PASS; zero losses. The one expected increase
  was `storage.buckets` from 0 to 1 for the `chat-attachments` bucket.
- Staging migration ledger: absent.

## Classification

| Migration | SHA-256 | Classification |
|---|---|---|
| `20261006000000_initial_application_schema.sql` | `4D9A4B81354E11A3BEBF4838E1D66FE5E9E629D27054AE79E3089C45373A7C82` | EXACTLY APPLIED |
| `20261007000000_add_agent_allowed_domains.sql` | `ED0491002406C8854650BFD8C05ACB4A8D5C2EBD417D34FA63F472B5F4E1E926` | EXACTLY APPLIED |
| `20261007010000_security_hardening.sql` | `ED1A69BADC675AEE76C3518924C42424409E72A7807DCDECE9DC8CFBCF7679E6` | PARTIALLY APPLIED |
| `20261009000000_subscription_billing.sql` | `8921FAD60BBAE5B2E0BD4EEDF108BA5A469470B841F9523E9A466134ABDD5FE5` | PARTIALLY APPLIED |
| `20261010000000_chat_attachments.sql` | `88B987219B9351DC519A8CF94FBA22048F7B7472B90AC7B2C272D85861AD87A6` | NOT APPLIED |
| `20261011000000_super_admin.sql` | `D9C0EB550151FB58000852CD2734C59A68A54E99A451E4A2EC4901BFE5EC4318` | NOT APPLIED |
| `20261012000000_leads_appointments.sql` | `CA1FA45DFED11B103EBCA802646D6C6AF7A36F2792E1AB3D0855E2D6D8C40164` | NOT APPLIED |
| `20261013000000_marketing_consent.sql` | `F50837F33BC1A210E8FC20BC89C70DCD533DFCAFA34E1C08A0895BE45B0795B2` | NOT APPLIED |
| `20261014000000_trial_recurring_payment_methods.sql` | `612A1F2D616318823A2943EC28548A37CCAEFAC137DF11F3C38F5E8E65D41360` | NOT APPLIED |
| `20261015000000_conversation_history.sql` | `BF8B10CE535ED3AACD7E59D5B0310F97073A5784DD16774991101D16ABFB652F` | NOT APPLIED |
| `20261016000000_chat_request_idempotency.sql` | `A3A5B2F2E0C3F9F40C39C9CBCA53651931DB09107B0EBD9490BF13150041A72D` | NOT APPLIED |
| `20261017000000_ai_credit_controls.sql` | `FB74CDA86EDB256B3F03FADE35C54003BBE2164761EA05E401099C3DD1DA1988` | NOT APPLIED |
| `20261018000000_nowpayments.sql` | `0697ECA13519E42DA3CC7F6BD32745A10D8576B7F66796737433D425196B92E7` | NOT APPLIED |

The two PARTIALLY APPLIED classifications are based on a positive primary-object
marker plus a changed normalized schema after replay. A table name alone was not
treated as proof of application.

## Proposed execution and ledger plan

Do **not** manually insert baseline rows before schema reconciliation. Doing so
would falsely hide the two partial migrations. Under separate authorization:

1. Revalidate backup hashes and staging project identity.
2. Set NOWPayments disabled and stop on the first migration error.
3. Use the approved migration runner to execute all 13 files in the exact order
   above. Migrations 1 and 2 are verified no-op replays; migrations 3 and 4
   reconcile drift; migrations 5–13 create the missing objects.
4. Allow that same migration runner to create and populate
   `supabase_migrations.schema_migrations`. Do not hand-write ledger rows.
5. Run the exact read-only verification transaction below, then roll back.

```sql
begin read only;
set local statement_timeout = '30s';
set local lock_timeout = '3s';

select version
from supabase_migrations.schema_migrations
order by version;

select count(*) = 13 as exact_version_count
from supabase_migrations.schema_migrations
where version in (
  '20261006000000','20261007000000','20261007010000','20261009000000',
  '20261010000000','20261011000000','20261012000000','20261013000000',
  '20261014000000','20261015000000','20261016000000','20261017000000',
  '20261018000000'
);

select to_regclass('public.nowpayments_payment_orders') is not null
  and to_regclass('public.chat_request_keys') is not null
  and to_regclass('public.ai_credit_control_config') is not null
  as required_terminal_objects_present;

rollback;
```

## Rollback considerations

- Before the first remote write, record a fresh recovery checkpoint and preserve
  backup `20261028-143641Z` unchanged.
- Each migration must stop on error; never mark a failed version as applied.
- Do not attempt down-migrations that would drop customer data. If verification
  fails, keep payments disabled, stop deployment, and restore only into a new
  disposable database for diagnosis.
- Restoring staging itself from backup requires separate destructive-recovery
  authorization.

## Deploy Preview and NOWPayments sandbox gates

1. Fresh Deploy Preview from the approved clean branch/commit.
2. Preview-only staging Supabase variables; production project reference must be
   rejected.
3. Preview-only sandbox API key/IPN secret, secret protected; sandbox API origin.
4. `NOWPAYMENTS_ENABLED=false` for initial route and isolation checks.
5. Register only the fresh verified preview webhook URL after separate approval.
6. Enable the provider only in the isolated preview, then run non-monetary
   sandbox checkout, valid signed IPN, duplicate IPN, invalid signature, partial,
   expired, refund, and manual-renewal cases.
7. Keep production locked and payments disabled until those checks pass.
