# AgentDesk AI final security review

Reviewed 8 October 2026. Scope: the active Desktop `agentdesk-ai` project (not `agentdesk-ai-backup`).

## Outcome

The Supabase compatibility blocker is fixed and the corrected hardening migration was applied successfully to the production `agentdesk-ai` project on 8 October 2026. Live SQL tests passed for RLS/grants, two existing accounts, service-role accounting, rate limits, refunds and UTC month compatibility. The milestone remains incomplete because hosted application/Auth configuration and end-to-end deployment checks remain unverified. The previous dependency audit's development advisory remains disclosed; its status was not rescanned in this compatibility repair.

## Supabase compatibility repair on 8 October 2026

Only the active `C:\Users\Abdul Halim Tabibzay\Desktop\agentdesk-ai` project was edited. Existing uncommitted work was retained; the backup project and secret values were not accessed or changed.

The live catalog confirmed `usage_limits.period_start` is `timestamptz`. The native reserve RPC returns a TABLE containing that timestamp, sets UTC month starts explicitly, and locks the account row. The native timestamp release RPC decrements only a matching period, clamps the counter at zero and updates `updated_at`. Both native function owners bypass forced RLS. The date overload previously cast directly to `timestamptz`, making its midnight depend on the session timezone. The rate RPC was absent, and neither private ledger table existed.

Changes in this repair:

- `supabase/migrations/20261007010000_security_hardening.sql`: preflight now requires native accounting matching the actual period column type, not the limiter it installs. Existing limiter argument names/defaults are preserved through `pg_get_function_arguments` and `CREATE OR REPLACE`, retaining dependencies; a missing limiter receives the complete secure implementation directly. No temporary allow-all function or function DROP/CASCADE is used.
- The reservation ledger retains its date column and adds `period_start_at timestamptz`. Timestamp accounting records and refunds the exact original instant, including precision. Date-only accounting remains supported. The service wrapper pins UTC, and the retained date compatibility overload explicitly converts UTC midnight. Refunds use the native timestamp overload and remain owner-bound, exactly once and transactional. Native counters, plans, limits and accounting bodies were retained, with empty search paths.
- `supabase/security-verification.sql`: adds period-column/ledger types, argument-default counts, service execution privileges and missing-timestamp checks.
- `supabase/live-security-regression.sql`: reproducible live assertions using two existing accounts and real production RPCs. All temporary test changes end with ROLLBACK; customer IDs/content are not returned.
- `tests/database-security.test.cjs`: expands PostgreSQL coverage to 17 database tests for missing/defaulted limiter signatures, TABLE/JSON results, date/timestamp overloads, timezone/precision/month boundaries, refund errors, preflight atomicity and migration replay.
- `SECURITY_DEPLOYMENT.md` and this report record the compatibility design, current evidence and remaining production work.

The production editor returned **Success. No rows returned** for the complete hardening transaction. The SQL submitted through the editor matched the tested migration after removing comments/whitespace. The successful migration query is [saved in Supabase](https://supabase.com/dashboard/project/cdynahtkwtcinjzmxjcs/sql/c1669a42-0ae3-4eaf-bf2e-db50eca80fb6).

The [live regression query](https://supabase.com/dashboard/project/cdynahtkwtcinjzmxjcs/sql/1e73a514-25d0-48ba-bef8-e2babd804b5b) returned **All live security assertions passed; transaction rolled back**. It verified all seven RLS/forced-RLS flags; no exposed anonymous relations or browser-executable public/private RPCs; protected billing/history/public-ID/installation fields; cross-account reads and writes denied for two existing accounts; service-role usage reserve/refund; wrong-owner and duplicate refunds denied; exactly ten of eleven rate requests allowed; older-month refunds did not decrement newer-month usage; and date compatibility in Asia/Kabul, America/Los_Angeles and Pacific/Kiritimati.

Customer row counts before migration were business profiles 2, knowledge 2, agents 2, widgets 2, conversations 10, messages 78 and usage accounts 2; usage totals were 32 messages and a 200 monthly limit. [Post-test verification](https://supabase.com/dashboard/project/cdynahtkwtcinjzmxjcs/sql/367c576a-881d-45d9-9698-7feaeca2c32e) confirmed every count and both totals unchanged, with zero persistent test reservations/buckets, 14 ownership policies, four input constraints and empty search paths/service execution on all six relevant RPC overloads. No old ledger rows needed timestamp reconstruction. On a different database with an older date-only ledger and unreleased timestamp-accounting reservations, the new refund deliberately fails closed rather than inventing an exact lost instant; those rows require private review.

PostgreSQL references: [function replacement/defaults and dependencies](https://www.postgresql.org/docs/current/sql-createfunction.html), [timezone conversion semantics](https://www.postgresql.org/docs/current/functions-datetime.html). Supabase reference: [database function permissions and security-definer search paths](https://supabase.com/docs/guides/database/functions).

## Root findings fixed

- Added explicit owner-bound database policies/grants, protected server-only fields, service-role-only RPC access, and database input constraints.
- Replaced the rate bucket with an atomic database implementation and added an account-wide burst bucket so changing visitor IDs cannot bypass the per-visitor limit.
- Added UUID usage reservations and exactly-once rollback, including correct behavior across monthly period changes.
- Limited and timed JSON request bodies, validated visitor/Public Agent IDs, bounded AI context/output, disabled provider response storage, and removed raw backend errors from logs/responses.
- Made inactive/malformed agent status fail closed and retained Public Agent ID resolution instead of exposing internal account IDs.
- Hardened Origin/CORS parsing, rejected opaque origins, enforced exact host allowlists, and preserved safe local development behavior.
- Hardened installation verification against SSRF, DNS rebinding, private/reserved networks, redirects, large/non-HTML bodies, hanging reads, forged Host/Origin input, false-positive markup, and excessive verification attempts.
- Rotated legacy predictable widget visitor IDs, scoped storage per agent, validated widget colors, used text-only rendering for untrusted settings/messages, and preserved cross-site embedding.
- Added client validation and stale-session/account-switch handling; registration errors no longer reveal raw auth details.
- Added CSP, HSTS in production, no-store API responses, anti-framing/nosniff/referrer/permissions headers, disabled browser source maps and framework disclosure, and documented the proxy/configuration boundary.
- Confirmed server secret values are absent from generated browser bundles. `.env.local` was preserved and no secret values were printed.

## Files changed

- `app/agent/page.tsx`
- `app/api/chat/route.ts`
- `app/api/verify-installation/route.ts`
- `app/api/widget-settings/route.ts`
- `app/business/page.tsx`
- `app/chat/page.tsx`
- `app/conversations/page.tsx`
- `app/install/page.tsx`
- `app/knowledge/page.tsx`
- `app/login/page.tsx`
- `app/register/page.tsx`
- `app/widget/page.tsx`
- `lib/client-security.ts`
- `lib/installation-verification.ts`
- `lib/origin-security.ts`
- `lib/request-security.ts`
- `lib/supabase.ts`
- `next.config.ts`
- `package.json`
- `package-lock.json`
- `public/widget.js`
- `README.md`
- `SECURITY_DEPLOYMENT.md`
- `supabase/migrations/20261007010000_security_hardening.sql`
- `supabase/security-verification.sql`
- `tests/client-security.test.cjs`
- `tests/database-security.test.cjs`
- `tests/security-chat.test.cjs`
- `tests/security-config.test.cjs`
- `tests/verify-installation.test.cjs`

## Verification results

- ESLint: pass, zero findings.
- Automated suite on 8 October: **95 passed, 0 failed, 0 skipped**, including 17 PostgreSQL tests. This includes chat failure rollback, origin isolation, ID validation, SSRF/DNS rebinding, installation ownership, request limits, CSP/config and client credential guards.
- PostgreSQL migration: synthetic fixtures and live production SQL assertions passed for the compatibility cases above. PGlite queues work on one connection: parallel-looking count tests are not evidence of true multi-session lock contention. The production row/unique-key locking implementations were inspected; a multi-session load test remains optional deployment validation.
- Production Next.js build: pass; all 18 routes/pages generated and TypeScript passed.
- Browser regression: login and registration rendered; seven-character passwords were blocked by browser validation; unauthenticated `/dashboard` redirected to `/login`.
- Previous dependency audit, retained as historical evidence: 0 known vulnerabilities in 29 production dependencies; 5 high findings representing one development-only `braces@3.0.3` advisory in the ESLint glob chain. A fresh registry audit was not part of this compatibility repair; do not treat the old scan as current or accept an unsafe Next.js downgrade suggestion.
- Configured Supabase read-only probe: Auth settings endpoint reachable, email signup enabled, email auto-confirm disabled. Anonymous REST probes returned 401 for all seven tenant tables, but that does not replace authenticated two-account RLS tests or SQL verification.

## Required live actions before 100%

1. Database migration and live SQL isolation/accounting verification are complete. Perform actual signed-in browser/REST end-to-end checks against the deployed app, including approved/denied widget domains, dashboard chat, installation verification and saved conversations.
2. In Supabase Auth verify the exact production Site URL and redirect allowlist, minimum password policy, signup/login rate limits and abuse protection. The previous public settings probe indicated email confirmation enabled.
3. Set the exact HTTPS `AGENTDESK_APP_ORIGIN` outside Vercel (or verify Vercel's production URL), deploy without development dependencies, and verify HTTPS/security/cache headers on the real deployment.
4. Re-run dependency audits and revisit the disclosed development advisory. Keep untrusted lint/CI jobs isolated with CPU/time limits until a compatible verified fix is installed.

## Milestone decision

Final Security Review: **not 100% yet**. The migration compatibility blocker and live database SQL review are complete. Remaining Auth/deployment/end-to-end checks can proceed now; a current dependency scan is still required.
