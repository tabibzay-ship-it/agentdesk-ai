# AgentDesk AI Phase 44 production readiness report

Date: 2026-11-06 (Asia/Kabul)

This report records read-only and local evidence only. It does not authorize a
production deployment, database migration, backup export, payment activation,
or Netlify publishing change.

## Verified local evidence

- Candidate branch: `codex/nowpayments-preview-isolation`.
- Candidate commit: `7bb4e58afd331b7768523413e1fb78706074538b`.
- All 13 committed migration files are ordered from `20261006000000` through
  `20261018000000`; their LF-byte SHA-256 values must be taken from the Git
  blobs, never from a CRLF working-tree conversion.
- Full unit, integration, security and disposable PGlite database suite:
  264 passed, 0 failed, 0 skipped on the current source.
- TypeScript, ESLint and the repository secret scan passed. The dependency
  audit completed with no high or critical findings, but reported 12 moderate
  transitive findings in `glob`/`minimatch`; its offered automatic remediation
  is a breaking `@opennextjs/cloudflare` change and was not applied.
- The production Webpack build generated all 53 static routes when supplied
  non-secret process-only build placeholders with external AI and payments
  disabled. No `.env` file was created.
- Authentication regression coverage includes enumeration-safe registration
  and recovery, bounded OTP attempts, signed recovery authorization, password
  update, global sign-out, session refresh/revocation, recovery-link replay and
  expiry, protected-route redirects, and two-account RLS isolation.
- Hosted staging Auth UI regression: 13 passed, 0 failed, with no account
  creation or email delivery.
- Production-preflight safety regressions: 2 passed, 0 failed.

## Committed LF migration hashes and dependencies

| Version | LF SHA-256 | Direct prerequisite |
| --- | --- | --- |
| `20261006000000` | `4D9A4B81354E11A3BEBF4838E1D66FE5E9E629D27054AE79E3089C45373A7C82` | Supabase `auth.users` and required roles/extensions |
| `20261007000000` | `ED0491002406C8854650BFD8C05ACB4A8D5C2EBD417D34FA63F472B5F4E1E926` | `20261006000000` (`agent_settings`) |
| `20261007010000` | `ED1A69BADC675AEE76C3518924C42424409E72A7807DCDECE9DC8CFBCF7679E6` | `20261006000000` native usage functions and owner tables |
| `20261009000000` | `8921FAD60BBAE5B2E0BD4EEDF108BA5A469470B841F9523E9A466134ABDD5FE5` | `20261007010000` security usage wrappers |
| `20261010000000` | `88B987219B9351DC519A8CF94FBA22048F7B7472B90AC7B2C272D85861AD87A6` | base account/conversation schema plus Supabase Storage |
| `20261011000000` | `7B003E2C5D4EE41BBFE7656A5F8FC33AAFF73D1C36A38D107E012FEF05B341CB` | Supabase Auth and hardened service-role grants |
| `20261012000000` | `1D771A1782DFEC70418320DEBEFA45D2769CEEB042F7E9DE3A7D2035FD32C852` | base `widget_settings` and account ownership schema |
| `20261013000000` | `3B58C3CA894941C9C84986324378B93C1CE98ACE78D14C8A64F7583B39806597` | Supabase Auth triggers and service-role grants |
| `20261014000000` | `612A1F2D616318823A2943EC28548A37CCAEFAC137DF11F3C38F5E8E65D41360` | `20261009000000` billing and `20261007010000` security wrappers |
| `20261015000000` | `BF8B10CE535ED3AACD7E59D5B0310F97073A5784DD16774991101D16ABFB652F` | base conversations/messages |
| `20261016000000` | `A3A5B2F2E0C3F9F40C39C9CBCA53651931DB09107B0EBD9490BF13150041A72D` | base account ownership and hardened service-only access |
| `20261017000000` | `FB74CDA86EDB256B3F03FADE35C54003BBE2164761EA05E401099C3DD1DA1988` | `20261014000000` billing/trial reservation wrappers |
| `20261018000000` | `0697ECA13519E42DA3CC7F6BD32745A10D8576B7F66796737433D425196B92E7` | `20261009000000` subscriptions plus later billing semantics |

The only safe execution order is the filename order above. A Windows CRLF hash
is not an approved migration identity and must not replace these Git-blob LF
hashes.

## Verified production hosting evidence

- Existing Netlify site ID: `93173397-e520-44cf-89f8-7476b1ade538`.
- Site/repository/branch: `musical-sunflower-fb3106`,
  `tabibzay-ship-it/agentdesk-ai`, `main`.
- Published deploy: `6acdc9c5f468d847c395ebf0`, commit
  `c5ca4409f0663ed2d079b79d9ac0f61a36ebda43`, state `ready`, deploy lock
  enabled.
- The production root and `/login` return HTTP 200. The currently published
  deploy returns HTTP 404 for `/forgot-password`, `/auth/callback`, and
  `/api/payments/nowpayments/webhook`; therefore it does not contain the release
  candidate and must not be used as evidence for those flows.

## Database status

- The current bounded production catalog preflight passed on 2026-11-06. Its
  sanitized report SHA-256 is
  `6BD3FF62691BB002B9C1C59D66A88628CFE39E13AA65683A4F1E17F66756BE8A`.
  It verified PostgreSQL 17.11, a 12,801,715-byte database, 15 application
  tables, 34 indexes, 18 RLS policies and 11 functions without querying customer
  rows. The transaction rolled back and performed no writes.
- The `supabase_migrations.schema_migrations` ledger is absent. Sentinel objects
  for versions `20261006000000` through `20261010000000` are present and support
  schema-equivalence, but those versions remain **AMBIGUOUS** as historical
  executions because no ledger exists. Every sentinel inspected for versions
  `20261011000000` through `20261018000000` is absent; those eight layers are
  **NOT APPLIED** in the current production schema.
- The preflight used TLS `verify-full`, process-level
  `default_transaction_read_only=on`, an explicit read-only transaction, a
  fingerprint-pinned and validity-checked Supabase Root 2021 CA, short
  statement/lock/idle timeouts, catalog queries only, and `ROLLBACK`.
- AI emergency-shutdown controls from `20261017000000_ai_credit_controls.sql`
  are not present in production. External AI must remain disabled.

## Required production sequence

1. Complete the bounded production catalog preflight and archive only its
   sanitized catalog report.
2. Compare catalog objects and the optional ledger with all 13 LF-hashed Git
   migrations. Stop on drift or ambiguity.
3. Under a separate approval, create the complete encrypted production backup
   set and independently restore it into an isolated Supabase-compatible target.
4. Rehearse any proposed ledger adoption and only the objectively missing
   migrations against that restored clone, in filename order.
5. Request separate approval for the exact production ledger/migration plan.
6. Keep Netlify locked while database changes are verified. Then request a
   separate merge/deployment approval for the exact reviewed commit.
7. Run public and authorized synthetic authenticated smoke tests; keep external
   AI and live payments disabled until separately approved.

## Owner-ready read-only command

From the repository root, run this command in PowerShell 7. It opens two hidden
prompts: first for the password-free production Session Pooler URI, then for the
database password. Neither secret is written to the command line or output.

```powershell
pwsh -NoProfile -File ".\scripts\backup\Invoke-ProductionReadOnlyPreflight.ps1" -OutputPath "$env:LOCALAPPDATA\AgentDeskAI\production-preflight\production-preflight-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).txt"
```

The URI must identify `postgres.cdynahtkwtcinjzmxjcs`, use a Supabase Session
Pooler on port 5432, and target database `postgres`. The launcher replaces any
TLS query settings with `sslmode=verify-full` and the fingerprint-pinned
Supabase Root 2021 CA. Any password copied inside the URI is discarded; the
separate hidden password prompt remains the only authentication source.

## Proposed production backup custody

- Ciphertext destination:
  `C:\Users\Abdul Halim Tabibzay\AppData\Local\AgentDeskAI\production-encrypted-backups`.
  It is outside Git, OneDrive recovery custody, and the USB recovery custody.
- Use two new production-specific age identities; do not reuse or modify the
  staging identities.
- Store only passphrase-encrypted Identity A in a new, uniquely named folder on
  the verified SanDisk USB. Store only passphrase-encrypted Identity B in a new
  production custody folder in OneDrive. Keep two distinct passphrases in the
  OneDrive-independent password manager.
- Stream every database/Storage artifact directly into age encryption. Never
  write plaintext dumps to disk. Copy only a completed, checksum-verified
  encrypted set to an independently recoverable destination.
- Require independent A/B decryption tests and a Supabase-compatible isolated
  restore before any migration approval.

Current local prerequisites: PostgreSQL `psql`, `pg_dump`, and `pg_restore`
17.11 **PASS**; age/age-keygen 1.3.2 **PASS**; OneDrive custody folder **PASS**;
SanDisk USB E: **BLOCKED** (not connected); Docker client 29.9.1 **PASS** but
Docker server and pinned Supabase image **BLOCKED**; C: has 9.71 GiB free and
capacity is **UNVERIFIED** until current production database and Storage sizes
are measured read-only with a safety multiplier.

## Release decision

- Local candidate verification: **PASS**.
- Production database compatibility: **FAIL / NO-GO** (eight required migration
  layers are absent and the first five have no trustworthy ledger entries).
- Production backup/restore: **BLOCKED** (no authorized production export in
  this phase).
- Existing-user hosted password reset and login completion: **BLOCKED** on
  owner-controlled credentials.
- Production deployment: **NO-GO**.
