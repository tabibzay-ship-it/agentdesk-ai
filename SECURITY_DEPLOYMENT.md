# AgentDesk AI production security requirements

Reviewed on 8 October 2026. This document describes the production configuration and deployment checks that accompany the source fixes. A passing local build does not verify the settings of a hosted Supabase project, reverse proxy or deployment.

## Verified Netlify deployment on 8 October 2026

Netlify published security release `aefdaff20b18f9a04025053d16085f87d75415a6` through the existing GitHub main-branch workflow. Production is [AgentDesk AI](https://musical-sunflower-fb3106.netlify.app); [the published deployment](https://app.netlify.com/projects/musical-sunflower-fb3106/deploys/6ac6bbd0ac83e300082d58bc) identifies that source commit. Subsequent documentation-only commits may use `[skip netlify]` to preserve this verified release, as supported by [Netlify deploy controls](https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/).

Netlify's public `AGENTDESK_APP_ORIGIN` is configured as the exact production origin in the Production context, all scopes. This is required by server origin checks and installation URLs; the Supabase Site URL is a separate Auth setting. Preview contexts were not given the production origin. Configure an exact origin for a preview if its authenticated installation flow is needed.

Next.js provides the application/function headers. Netlify serves `/widget.js` directly, so `netlify.toml` provides its nosniff and referrer policy separately. Both boundaries were verified on deployed responses; Netlify retains its HSTS. No widget CORP/COEP restriction was added. [Netlify custom header behavior](https://docs.netlify.com/manage/routing/headers/).

The latest review passed lint, 95 tests with no skips, independent TypeScript/build, 21 production HTTP checks, 10 live domain checks, six downloaded-widget behavior checks and actual signed-in/dashboard/cross-site widget chat/conversation/logout checks. Fresh audit results are zero production vulnerabilities and five high development-only findings from the single disclosed advisory below. See `SECURITY_REVIEW_REPORT.md` for evidence and remaining checks. Live SQL migration/accounting tests were historical evidence from the earlier repair; no migration was rerun in this deployment.

## Runtime and repeatable installation

Use a maintained Node.js 24 LTS release, or a maintained Node.js 22 LTS release. The installed Supabase and OpenAI SDKs require Node.js 22 or newer; the previous README minimum of Node.js 20 is insufficient. Node.js 20 is also end of life as of this review. See the [official Node.js release support table](https://nodejs.org/en/about/previous-releases).

Use the committed lockfile with `npm ci`. Build in an isolated environment with development dependencies, then deploy a runtime that does not contain development dependencies. Never expose `next dev` or the development MCP/debug interfaces to the Internet. Use `npm run build` followed by `npm run start`, with `NODE_ENV=production`.

Before release, run:

```text
npm run lint
npm test
npm run build
npm audit --json
npm audit --omit=dev --json
```

Audit outcomes and the full project tests must be recorded in the accompanying review report. An unavailable registry scan is an unverified check, not a clean result. Audit scans report known registry advisories; they are not proof that every dependency is safe. [npm audit documentation](https://docs.npmjs.com/cli/v11/commands/npm-audit/)

## Remaining dependency advisory

The audited lockfile contains `braces@3.0.3` in the development-only ESLint dependency chain: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) rates malicious deeply nested brace patterns as a high-severity process denial of service and lists no patched version as of the refreshed 8 October 2026 audit. The five npm findings describe this same issue and affected dependency chain.

The application does not accept user-controlled glob patterns into this library, and this dependency chain is not part of the production runtime when development dependencies are omitted. Run CI/lint jobs for untrusted changes in disposable workers with time and resource limits. Do not use `npm audit fix --force` to downgrade Next.js/its ESLint configuration: that recommendation is not a safe remediation for this project. Revisit the advisory when an upstream compatible fix exists. This high advisory remains disclosed until a verified fix is installed.

The installed Next.js `16.3.8` is newer than the fixes for the [Windows server remote-code-execution advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) (fixed in `16.3.3`) and [Node ImageResponse remote-code-execution advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) (fixed in `16.3.6`). React `19.2.8` is the patched release named in the [July Server Functions denial-of-service advisory](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g). This is an assessment of these named advisories, not a substitute for the full lockfile audit.

## Environment and server secrets

Keep `.env.local` private and preserve its existing values. Store production secrets in the host's secret manager. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are intended for browser bundles. Keep `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` server-only; never add them to `NEXT_PUBLIC_*`, `next.config.ts`'s `env` object, HTML, widget configuration, client components, public files, logs or test reports.

`NEXT_PUBLIC_SUPABASE_URL` must be the exact HTTPS project origin in production, with no credentials, path, query or fragment. The configured CSP derives only that origin and its corresponding WSS origin. Public environment values are fixed into browser bundles at build time; rebuild when changing projects. [Next.js environment variable documentation](https://nextjs.org/docs/app/guides/environment-variables)

Rotate a credential if it has actually been exposed. A public Supabase publishable key or Public Agent ID is expected to be visible; neither grants owner permissions. Authentication and database policies must enforce ownership independently.

## HTTPS, headers and proxy boundary

The production host must terminate valid HTTPS and redirect HTTP to HTTPS. The app emits one-year HSTS for its own hostname, without making commitments for unrelated subdomains. Development does not emit HSTS. Check the deployed responses because a CDN or reverse proxy can replace application headers.

`next.config.ts` disables the framework identification header and production browser source maps. Responses include `nosniff`, `X-Frame-Options: DENY`, a restrictive referrer policy, disabled camera/microphone/geolocation, and a Content Security Policy. The CSP restricts connections to the application's own origin and its exact Supabase HTTPS/WSS origin, blocks object embeds, restricts base/form targets, and denies framing. API responses receive `Cache-Control: private, no-store, max-age=0`; the proxy/CDN must respect it.

Static Next.js hydration and existing inline styles require `'unsafe-inline'`. Production does not allow `'unsafe-eval'`. A stricter nonce policy is future defense in depth and would require dynamic rendering and compatibility testing; the current CSP is not an assurance against every possible inline-script injection. [Next.js CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy)

For self-hosting, place a reverse proxy in front of Next.js. Limit request-body size, header size, connection duration and concurrent requests at that boundary. Restrict direct access to the internal Next.js port. Strip or overwrite client-supplied forwarded-host/protocol/client-IP headers; preserve the public request origin consistently. Apply network-level abuse limits in addition to application and database limits. [Next.js self-hosting guidance](https://nextjs.org/docs/app/guides/self-hosting)

## Supabase and account isolation

Apply the supplied migrations in filename order after reviewing them against the actual existing schema. Confirm row-level security is enabled for every tenant table, owner checks cover both existing rows and proposed writes, and anonymous/authenticated roles cannot execute service-only rate/usage functions or edit counters and entitlements. Do not infer that database policies exist from client-side `.eq("user_id", ...)` filters.

The hardening compatibility repair was applied to production on 8 October 2026. Its preflight accepts date accounting with the native date release RPC, or timestamp accounting with the native timestamp release RPC. It creates a missing rate RPC directly, or retains existing argument defaults/dependencies during secure replacement. Do not install an allow-all placeholder or manually drop the limiter. Production uses UTC `timestamptz` month tokens: reservations keep the exact timestamp, and date compatibility explicitly means UTC midnight. A date alone cannot reconstruct an arbitrary timestamp. An older ledger with unreleased entries lacking timestamps must be reviewed privately; the new refund fails closed for such entries.

`supabase/live-security-regression.sql` exercises two existing accounts, production permissions and real accounting/rate RPCs inside a transaction that ends with ROLLBACK. It prints a verdict without account IDs or customer content. It was run successfully during this repair. Run the synthetic PostgreSQL tests with `AGENTDESK_PGLITE_ROOT` pointing to a separate PGlite test dependency directory; without it the database tests are skipped. The runtime is a test tool, not a production dependency.

Run the provided database verification queries and two-account negative tests against the deployed project. Test that one signed-in user cannot read or change another user's businesses, agent, knowledge, widget settings, conversations or messages; test anonymous access separately. Preserve the migration/verification output without copying account tokens or keys into reports.

Hosted Supabase Auth was inspected on 8 October: Site URL is the exact production origin and the sole redirect entry is `https://musical-sunflower-fb3106.netlify.app/**`. Email confirmation and secure email change are enabled; anonymous sign-in and manual identity linking are disabled; public signup is enabled. The server password minimum is **six**, while the application requires eight; align the server minimum with the application. No composition requirement is selected. CAPTCHA, secure password change/current-password checks and leaked-password protection are disabled; leaked-password protection is shown as Pro-tier only. Enabling CAPTCHA requires client token integration and regression checks.

Hosted Auth limits are signup/sign-in 30 requests per five minutes per IP, refresh 150 per five minutes per IP, and verification 30 per five minutes per IP. IP forwarding is disabled. Assess the limits and account-change protections against the product's policy and expected traffic; they were inspected, not load-tested. No Supabase Auth setting was changed in this deployment review. Fresh signup/email-confirmation and browser account-switching flows remain untested.

## Widget and installation verification

The widget loads as a script and creates DOM elements on the customer website. The app's anti-framing CSP does not block this installation method. Customer sites that already enforce their own CSP must allow the AgentDesk script and API origin and support the widget's inline styles. Do not add a same-origin-only Cross-Origin-Resource-Policy or cross-origin isolation header to `/widget.js` without retesting installed widgets.

Public Agent IDs, browser Origin headers and domain allowlists are not secrets or proof of caller identity. A server client can forge an Origin. Keep durable usage/rate controls and provider spending controls even when browser CORS succeeds. List exact approved customer hostnames; do not treat a suffix match as authorization. Installation verification reads public HTML and should never become a generic internal-network fetch endpoint.

Production checks passed for approved/denied/suffix/missing origins across both restricted agents, customized cross-site widget mounting and real chat, dashboard chat, saved conversations, session restoration and logout/protected redirect. Installation displayed the correct production script URL and preserved its saved status when a disallowed loopback URL was rejected.

Positive hosted installation verification remains open: the signed-in agent has only localhost allowed, and production verification intentionally rejects private/local destinations. Add the actual public customer hostname and install the static production script tag on that page before testing successful fetch/detection. Dynamic script insertion on the application's test page is not evidence of static installation detection. The two intentional AI smoke replies consumed two monthly usage units and remain as two saved conversations; no customer allowlists or website settings were changed.
