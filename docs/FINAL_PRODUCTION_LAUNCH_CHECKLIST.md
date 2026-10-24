# AgentDesk AI final production launch checklist

This checklist prepares the existing `getagentdeskai.com` deployment. It does not authorize a deploy, migration, paid request, email, OAuth activation, or payment transaction.

## Netlify release and rollback

1. Confirm the existing Netlify site ID `93173397-e520-44cf-89f8-7476b1ade538`, GitHub repository `tabibzay-ship-it/agentdesk-ai`, production branch `main`, and canonical domain `https://getagentdeskai.com`. Do not create another site.
2. In Production scope, verify the names `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and `AGENTDESK_APP_ORIGIN`. The origin must be `https://getagentdeskai.com`; the Supabase origin must be `https://cdynahtkwtcinjzmxjcs.supabase.co`. Never copy secret values into logs, source, deploy previews, or chat.
3. Keep the build command `npm run build:netlify`, Node `22.13.0`, and the exact GitHub check `Production quality gate / verify`.
4. Before merge, run `npm run verify:deploy`, `npm run build`, the isolated authenticated browser suite, and review every tracked and untracked file.
5. After an authorized deploy, record the commit and Netlify deploy ID; run `npm run verify:production` plus synthetic authenticated checks that do not call paid AI or payments.
6. On a code regression, stop deploys and publish the last verified Netlify deploy. Do not revert a database migration by deleting data. Use only a separately reviewed compensating migration or the encrypted restore procedure.

## OpenAI activation

1. The server uses `gpt-5-mini`, `maxRetries: 0`, a 45-second timeout, and `store: false`. The browser never receives the API key.
2. Keep rate limits, attachment ownership, atomic multi-credit reservations, exact refunds, settlement, per-user/global daily ceilings, and the emergency shutdown enabled. Verify the append-only private ledger is inaccessible to browser roles. Operations telemetry may retain status, model, token counts, safe provider/request IDs and error classification only; it must not retain prompts, responses, headers, account IDs, or secrets.
3. Before public launch, separately authorize one synthetic, quota-bounded production request. Record status, visible output, usage, incomplete reason and estimated cost. Do not retry a paid failure automatically.
4. Alert on rising provider authentication, rate-limit, timeout, incomplete-response, persistence, and quota-refund failures.

## Payment-provider activation

Do not activate checkout, saved payment methods, webhooks, or paid entitlements until a lawful provider is selected and all of the following are supplied and reviewed:

- provider name and supported merchant country/legal-entity requirements;
- approved sandbox credentials and server-side secret-storage location;
- hosted-checkout and hosted payment-method origins;
- signed-webhook secret, signature algorithm, timestamp/replay tolerance and documented event IDs;
- sandbox product/price identifiers for Starter USD 9 monthly and Pro USD 29 monthly;
- event mapping for active, past-due, cancel-at-period-end, canceled, failed payment, payment method replacement/removal, refund and dispute;
- supported currency, tax/invoice responsibilities, refund/chargeback policy, settlement account and customer-support contact;
- production webhook URL and provider retry/out-of-order behavior.

Rehearse invalid signatures, duplicates, replay, out-of-order events, cancellation and failed payments in the provider sandbox. A browser redirect must never activate an entitlement; only a verified, idempotently reconciled webhook may do so.

## SMTP and OAuth

1. For recovery email, verify the Brevo transactional sender/domain, SPF, DKIM and DMARC; install the reviewed one-time-link template using `{{ .ConfirmationURL }}` without click rewriting or tracking parameters. Test one approved disposable recipient, including expiry, single use and replay rejection, and distinguish provider acceptance from inbox delivery.
2. Confirm Supabase Site URL `https://getagentdeskai.com` and exact callback/redirect allow-list entries before changing Auth settings.
3. Keep `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` while the Afghanistan Google Cloud onboarding blocker remains. Keep Facebook disabled until its app, scopes, privacy review and real callback are approved.
4. A real OAuth login must confirm PKCE callback completion, safe local redirect, account isolation, identity-linking behavior and one-trial-per-verified-identity before its public flag is enabled.

## Monitoring and incident response

1. Configure an approved deploy-success monitor for HTTPS/TLS, canonical redirects, public routes and the safe invalid-widget API path. The repository provides `npm run verify:production`; it performs no writes.
2. Use a server-side log destination with access control, retention and redaction. Track aggregate Auth errors, API 4xx/5xx, quota reservation/refund failures, upload rejections, webhook signature failures and database latency. Never log passwords, OTPs, authorization headers, API keys, prompts, customer messages or file contents.
3. The authenticated Super Admin health view checks database reachability/latency and reports payments disabled. It is not a public uptime endpoint. Use an external HTTPS monitor for public availability and an authorized synthetic account for private workflows.
4. Assign an incident owner and private security contact. Define severity, notification, evidence retention, credential rotation, deploy rollback and database-recovery decisions before launch.

## Final authorization gates

Separate explicit approvals are required for: production migrations; production SMTP/template changes and a real email; OAuth provider changes; a paid OpenAI request; payment-provider configuration; Git push/merge; and Netlify production deployment. Public launch is blocked until each applicable gate has real production evidence and a recorded rollback owner.
