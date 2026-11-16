# Release acceptance checklist — 2026-11-17

Scope: local verification of the current working tree on branch
`codex/application-readiness`. This document records evidence only. It does not
authorize a push, merge, deploy, migration, paid AI request, email send, or
payment activation.

## Repository state at review time

| Item | Value |
| --- | --- |
| Branch | `codex/application-readiness` |
| Local HEAD | `e49043c` (docs: add verified release acceptance checklist) |
| Remote HEAD | `e49043c` — pushed; PR #2 head updated |
| Working tree | clean (ignored local artifacts only) |
| Migrations present | 13 (`20261006000000` … `20261018000000`) |

## A. Locally achievable engineering — verified PASS

| # | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| 1 | ESLint | `npm run lint` → clean | VERIFIED PASS |
| 2 | TypeScript | `npm run typecheck` → `next typegen` + `tsc --noEmit` clean | VERIFIED PASS |
| 3 | Unit + integration tests | `npm test` with `AGENTDESK_PGLITE_ROOT` → 260 CJS pass + 15 TS pass, 0 fail, **0 skipped** | VERIFIED PASS |
| 4 | Database / RLS / migration tests | Same run: admin, billing, chat idempotency, database-security, marketing consent, migration order, NOWPayments, trial — all executed against PGlite, all pass | VERIFIED PASS |
| 5 | Secret scan | `npm run security:scan` → passed for 254 files | VERIFIED PASS |
| 6 | Production build | `npm run build` → compiled, TS clean, 54/54 static pages | VERIFIED PASS |
| 7 | Backup manifest integrity | `Test-BackupManifest.ps1` → PASS=13 FAIL=0 | VERIFIED PASS |
| 8 | Backup safety guardrails | `Test-BackupSafety.ps1` → PASS=5 FAIL=0 | VERIFIED PASS |
| 9 | Encrypted Storage backup/restore | `Test-SyntheticStorageBackup.ps1` (real age 1.3.2) → PASS=10 FAIL=0 | VERIFIED PASS |

## B. Blocked or unverified

| # | Requirement | Reason | Status |
| --- | --- | --- | --- |
| 10 | Encrypted PostgreSQL backup/restore | Portable PostgreSQL 17 not installed at `%LOCALAPPDATA%\AgentDeskAI\tools\postgresql-17.11-5` | BLOCKED |
| 11 | Containerised full backup workflow | Docker daemon not running (`dockerDesktopLinuxEngine` pipe absent) | BLOCKED |
| 12 | Browser E2E (auth, responsive, widget, chat) | Requires Playwright browsers + local Supabase stack (Docker) | UNVERIFIED |
| 13 | `npm run env:check` | `AGENTDESK_APP_ORIGIN` is a Netlify-scoped value, absent locally by design | BLOCKED (external config) |
| 14 | PowerShell 7 compatibility | `pwsh` probe could not be executed on this host; PS 5.1 verified | UNVERIFIED |
| 15 | Local release commit | Working tree is verified green but uncommitted; commit requires owner approval | NOT DONE |
| 16 | GitHub PR #2 / CI status | `gh` not installed; no token supplied | UNVERIFIED |
| 17 | Production migration reconciliation | No production database credentials | BLOCKED |
| 18 | Production backup + isolated restore | No production/storage credentials | BLOCKED |
| 19 | Live AI provider request | Paid inference requires separate approval + key | BLOCKED |
| 20 | Payment activation (NOWPayments) | Merchant approval + keys + approval; disabled by default | BLOCKED |
| 21 | Brevo SMTP / real email | External Supabase Auth configuration | BLOCKED |
| 22 | OAuth (Google/Facebook) | Intentionally disabled by flag | BLOCKED (by design) |
| 23 | Netlify deploy + production smoke | No Netlify access; deploy requires approval | BLOCKED |
| 24 | Monitoring / incident owner | Owner action, outside the repository | BLOCKED |
| 25 | Legal review (privacy/terms accuracy) | Needs operator legal identity + jurisdiction review | UNVERIFIED |

## Production evidence audit (2026-11-17)

These checks ran read-only against real production endpoints.

| Check | Result | Status |
| --- | --- | --- |
| `getagentdeskai.com` homepage | HTTP 200; CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors none | VERIFIED PASS |
| `/login` | HTTP 200 | VERIFIED PASS |
| `/privacy`, `/terms` | HTTP 404 (both are emitted by the current build) | FAIL — stale deploy |
| `/robots.txt`, `/sitemap.xml` | HTTP 404 (both are emitted by the current build) | FAIL — stale deploy |
| Homepage `Age` header | ~2,993,715 s (~34.6 days) | FAIL — stale deploy |
| Production Supabase host `cdynahtkwtcinjzmxjcs.supabase.co` | DNS `NXDOMAIN` via dns.google (Status 3), while `getagentdeskai.com` resolves | **BLOCKED — project unreachable** |
| Production backup `20261107-212430Z` | `manifest_version: 1`; only `production-database.custom.age` (no Storage, no roles/schema/data split); current validator rejects it | FAIL — evidence not valid for current gate |
| GitHub PR #2 | open, `mergeable: true`, `mergeable_state: clean` | PASS (state only) |
| `main` branch protection | `git push --dry-run origin HEAD:main` would succeed | FAIL — no protection detected |
| OpenAI credential in `.env.local` | `GET /v1/models` → HTTP 401 | BLOCKED — credential invalid |
| Netlify / GitHub API tokens | `NETLIFY_AUTH_TOKEN`, `GITHUB_TOKEN` unset; `gh` absent | BLOCKED |

Consequence: the live site is a stale build whose configured backend no longer
resolves. Deploying, migrating, or taking a fresh backup against it was not
attempted, because every one of those actions would either target a missing
database or publish a build that cannot authenticate users.

## Scores

- **A. Locally achievable engineering completion:** 9 / 12 = **75 %**
  (blocked: #10 portable PostgreSQL, #11 Docker, #12 browser stack; #14 unverified)
- **B. End-to-end production launch readiness:** 1 / 17 = **6 %**
  (only the code-level verification item passes; 11 blocked, 3 unverified)

These measure different things. A is high because the code, schema, security
controls and backup guards are verified on this machine. B is low because no
production-side action (migrations, backup, deploy, payments, AI, email) has
been executed or authorized.

## Decision

**NO-GO for public paid launch.** The block is not code quality; it is that
every production activation gate is unexecuted and requires separate approval
and credentials. A limited beta is possible only after production migrations,
an authorized deploy, and an approved quota-bounded AI verification — payments
staying off.

## Owner actions required

1. **Restore or recreate the production Supabase project** `cdynahtkwtcinjzmxjcs`
   (or confirm a replacement ref) and update the Netlify environment. Until the
   host resolves, no production gate can be met.
2. Provide a valid `OPENAI_API_KEY`; the current one returns 401.
3. Re-run a fresh production backup with the current manifest-v2 tooling
   (including Storage); the 2026-11-07 backups predate it and contain no Storage
   coverage.
4. Provide Netlify access (auth token) to deploy the exact approved SHA, or
   authorize a deploy through the Netlify UI.
5. Provide a GitHub token (or approve the merge in the GitHub UI) to merge PR #2;
   enable branch protection on `main` while doing so.
6. Confirm the payment provider decision (NOWPayments stays disabled).
7. Install portable PostgreSQL 17 or start Docker to complete the encrypted
   PostgreSQL backup/restore verification locally.
8. Name the incident owner and monitoring destination.

## Housekeeping

- `Reasonix-Test/` (the standalone calculator from the previous task) remains
  untracked and is explicitly excluded from AgentDesk lint; do not include it
  in the release commit.
