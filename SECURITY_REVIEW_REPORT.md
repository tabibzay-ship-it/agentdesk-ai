# AgentDesk AI final security review

Reviewed 8 October 2026. Scope: the active Desktop `agentdesk-ai` project (not `agentdesk-ai-backup`).

## Outcome

The production header and deployment checks pass. Netlify published security release `aefdaff20b18f9a04025053d16085f87d75415a6`; lint, all 95 tests, TypeScript/build, 21 production HTTP checks, 10 live widget-domain checks, real embedded-widget/dashboard chat and conversation persistence passed. The refreshed production dependency audit reports zero vulnerabilities. Final Security Review remains incomplete: positive public-site installation verification, signup/email-confirmation and account-switching flows, and the server password/abuse policy remain open. The full audit retains five high development-only findings representing one underlying advisory. The current production review below supersedes historical pending deployment/audit statements in the compatibility-repair section.

## Production deployment review — 8 October 2026

The production header gap is resolved on [AgentDesk AI](https://musical-sunflower-fb3106.netlify.app). Netlify published [GitHub commit `aefdaff20b18f9a04025053d16085f87d75415a6`](https://github.com/tabibzay-ship-it/agentdesk-ai/commit/aefdaff20b18f9a04025053d16085f87d75415a6) in [deploy `6ac6bbd0ac83e300082d58bc`](https://app.netlify.com/projects/musical-sunflower-fb3106/deploys/6ac6bbd0ac83e300082d58bc). The active Desktop `agentdesk-ai` project was used; the backup project was excluded. **Final Security Review remains incomplete** pending the positive public-site installation check, remaining Auth flows and password/abuse policy decisions below.

### Changes and compatibility

Fresh predeployment document responses already had nosniff, referrer policy and HSTS; CSP was missing. The static widget lacked nosniff/referrer headers. This release publishes the previously uncommitted, coherent application/widget security hardening alongside the widget-compatible header configuration. It matches the already-applied SQL hardening; no production migration was rerun.

Production now delivers CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, restricted permissions, HSTS and no-store API responses. Browser source maps and framework disclosure remain disabled. `netlify.toml` adds nosniff/referrer headers specifically to `/widget.js`; Next.js supplies application/function response headers. This respects [Netlify's static-file/function header boundary](https://docs.netlify.com/manage/routing/headers/).

CSP allows same-origin requests and the exact production Supabase HTTPS/WSS origins. OpenAI requests remain server-side through the application's API. `'unsafe-inline'` is retained for current static hydration and styles; `'unsafe-eval'` is absent in production. A nonce policy would require changes to rendering and caching, as described in [Next.js CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy). This CSP is defense in depth and does not eliminate inline-script injection risk.

The installed widget mounts DOM through an external script and does not use an iframe. Denying framing of AgentDesk pages is compatible with that architecture. No `Cross-Origin-Resource-Policy: same-origin` or `Cross-Origin-Embedder-Policy` was added to the widget. Customers with their own CSP must still permit the widget script and API connections under their site's policy.

Netlify's public `AGENTDESK_APP_ORIGIN` is set to the exact production origin for the Production context, with all scopes. The preexisting Supabase Site URL was verified to match that origin and its sole redirect entry is `https://musical-sunflower-fb3106.netlify.app/**`; this task made no Supabase Auth setting changes.

### Checks passed

- ESLint: zero findings. Automated suite: **95 passed, 0 failed, 0 skipped**, including all 17 synthetic PostgreSQL checks. Independent TypeScript check and production build passed.
- Deployed HTTP/header/API checks: **21 passed, 0 failed**. They cover five document routes, actual CSP/nosniff/referrer/HSTS/frame headers, widget MIME and embedding compatibility, HTTP-to-HTTPS redirect, no-store API responses, credential-free CORS, rejected opaque/malformed origins, malformed/oversized/unsupported requests, unauthenticated installation rejection and the exact production installation URL.
- Live widget domain checks: **10 passed, 0 failed** across both existing restricted agents. Approved configured domains and the production origin returned 200; random domains, suffix/lookalike hosts and missing Origin returned 403. These were read-only settings probes, with no AI requests or database mutations.
- The downloaded production widget passed **six behavioral smoke checks** using mocked DOM/API responses: mounting/toggling without an iframe, invalid-ID/settings failure, duplicate-script handling, hostile text/color safety and secure visitor rotation, storage denial, and inactive/offline sending behavior.
- Actual production `/widget.js` mounted on the existing approved localhost customer fixture, loaded the saved custom name/welcome/color and opened/closed correctly. A real cross-origin widget chat and its CORS preflight passed. The fixture's CSP allowed a production login iframe, while the deployed AgentDesk frame policy still blocked its display, confirming that framing protection and script embedding coexist.
- Authenticated production checks passed after the user signed in directly. A fresh dashboard restored the session and existing aggregate data; one dashboard chat and one embedded-widget chat each received a successful AI reply. Conversations retained both test prompts and replies. Final usage increased **25 to 27 of 100** for exactly two replies, and conversations increased **8 to 10**. Both intentional test conversations remain saved; no records were deleted. Logout returned to `/login`, and reopening `/dashboard` redirected to `/login` without exposing customer data. Sign-in credentials were not handled by the agent.
- Authenticated installation UI displayed the correct production script URL and existing installed status. A verification attempt targeting `https://127.0.0.1` was rejected as an unapproved domain and preserved the saved installation state. The selected agent's allowlist contains only localhost, so no eligible public customer URL was available for a positive production verifier test.
- Private secret comparisons found neither server secret value in **31 public/browser files or 53 published source files**. Secret values were not printed or placed in evidence.
- Fresh registry audit: **0 production dependency vulnerabilities**. Full audit: **5 high findings** in the development-only ESLint/glob chain, representing one underlying `braces@3.0.3` advisory. [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) currently lists no patched version. No forced downgrade was applied. `npm ls --all` passed; 369 installed versions match the lockfile, with only 80 optional platform entries absent. Keep untrusted lint/CI work isolated and resource-limited until a compatible verified fix exists.

Evidence: `production-security-check.json`, `production-widget-domain-checks.json`, and deployment, origin, password-policy, chat, conversation, widget and logout screenshots. Earlier successful production SQL migration/isolation/accounting tests remain historical evidence from the compatibility repair; they were not rerun during this deployment review. The 17 database tests above use synthetic fixtures. Beyond the two intended smoke conversations/replies, two usage charges and a verification rate-limit token, this review made no website, allowlist or database changes.

### Remaining checks and user decisions

1. Provide an actual published public customer hostname in the agent's allowed domains and install the production widget tag on that site's page. Then complete positive hosted installation verification. Localhost/private addresses are intentionally blocked by the production SSRF policy. Existing installed status and a negative verification check passed; they do not prove positive fetching/detection on a public host.
2. Complete fresh signup/email-confirmation and account-switching flows. Sign-in, restored session, dashboard chat, real cross-origin widget chat, saved conversation retrieval and logout to `/login` passed. Protected-page redirect after logout also passed.
3. Align the Supabase server password minimum with the application's eight-character requirement: the verified server minimum is currently six, with no composition requirement. The browser's minimum does not protect direct Auth requests.
4. Decide the production abuse/account-change protections. Email confirmation and secure email change are enabled; anonymous sign-in is disabled; public signup is enabled. CAPTCHA, secure password change/current-password checks and leaked-password protection are disabled; leaked-password protection is shown as requiring the Pro tier. Enabling CAPTCHA requires compatible client integration. No Auth settings were changed in this review.
5. Verified Auth limits are signup/sign-in **30 requests per five minutes per IP**, refresh **150 per five minutes per IP**, and verification **30 per five minutes per IP**. Assess these against expected traffic and the chosen CAPTCHA/abuse policy. Their presence is verified; effectiveness under attack has not been load-tested. The disclosed development-only advisory also remains open until a compatible fix is verified.

Deployment headers, safe rejection behavior, restricted widget domains, real embedded-widget chat, authenticated dashboard/conversation persistence and the refreshed production audit pass. Positive public-site installation verification, remaining Auth flows and the server password/abuse policy remain open, so this review must not be marked 100% complete.

## Earlier Supabase compatibility repair on 8 October 2026

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
- `netlify.toml`
- `package.json`
- `package-lock.json`
- `public/widget.js`
- `README.md`
- `SECURITY_DEPLOYMENT.md`
- `SECURITY_REVIEW_REPORT.md`
- `supabase/migrations/20261007010000_security_hardening.sql`
- `supabase/security-verification.sql`
- `supabase/live-security-regression.sql`
- `tests/client-security.test.cjs`
- `tests/database-security.test.cjs`
- `tests/security-chat.test.cjs`
- `tests/security-config.test.cjs`
- `tests/verify-installation.test.cjs`

## Earlier compatibility-repair verification results

- ESLint: pass, zero findings.
- Automated suite on 8 October: **95 passed, 0 failed, 0 skipped**, including 17 PostgreSQL tests. This includes chat failure rollback, origin isolation, ID validation, SSRF/DNS rebinding, installation ownership, request limits, CSP/config and client credential guards.
- PostgreSQL migration: synthetic fixtures and live production SQL assertions passed for the compatibility cases above. PGlite queues work on one connection: parallel-looking count tests are not evidence of true multi-session lock contention. The production row/unique-key locking implementations were inspected; a multi-session load test remains optional deployment validation.
- Production Next.js build: pass; all 18 routes/pages generated and TypeScript passed.
- Browser regression: login and registration rendered; seven-character passwords were blocked by browser validation; unauthenticated `/dashboard` redirected to `/login`.
- Previous dependency audit, retained as historical evidence: 0 known vulnerabilities in 29 production dependencies; 5 high findings representing one development-only `braces@3.0.3` advisory in the ESLint glob chain. A fresh registry audit was not part of this compatibility repair; do not treat the old scan as current or accept an unsafe Next.js downgrade suggestion.
- Configured Supabase read-only probe: Auth settings endpoint reachable, email signup enabled, email auto-confirm disabled. Anonymous REST probes returned 401 for all seven tenant tables, but that does not replace authenticated two-account RLS tests or SQL verification.

## Milestone decision

Final Security Review: **not 100% yet**. The migration compatibility repair and prior live SQL isolation/accounting review are complete. The current production deployment, header, authenticated chat/conversation, cross-site widget and refreshed dependency checks have now passed. The remaining checks and decisions are listed in the current production review above.
