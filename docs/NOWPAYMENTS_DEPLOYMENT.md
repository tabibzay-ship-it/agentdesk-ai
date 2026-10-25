# NOWPayments deployment and sandbox runbook

This integration is disabled by default. It creates hosted invoices server-side,
accepts signed IPNs at `/api/payments/nowpayments/webhook`, and activates or
renews access only after a verified `confirmed` or `finished` payment event.
It never performs a withdrawal and does not automatically charge a customer.

## Server-only configuration

Never paste credentials into source files, issue trackers, pull requests, chat,
or build logs. In Netlify, enter secret values directly in **Site configuration →
Environment variables** and mark them sensitive. Do not use a `NEXT_PUBLIC_`
prefix. Restrict production credentials to the Production context. Use a separate
sandbox account and separate credentials for Deploy Previews.

| Variable | Deploy Preview | Production |
| --- | --- | --- |
| `NOWPAYMENTS_ENABLED` | `false` initially | `false` until final approval |
| `NOWPAYMENTS_API_ORIGIN` | `https://api.sandbox.nowpayments.io` | `https://api.nowpayments.io` |
| `NOWPAYMENTS_API_KEY` | sandbox secret | production secret |
| `NOWPAYMENTS_IPN_SECRET` | sandbox secret | production secret |
| `AGENTDESK_APP_ORIGIN` | exact preview HTTPS origin | `https://getagentdeskai.com` |

The callback URL is derived from `AGENTDESK_APP_ORIGIN`; there is no separate
callback secret or callback environment variable. Production resolves to:

`https://getagentdeskai.com/api/payments/nowpayments/webhook`

## Create separate sandbox credentials

1. Open the official NOWPayments sandbox, not the production dashboard.
2. Create a sandbox-only merchant account using the owner's approved address.
3. In sandbox Store/Payment settings, generate a sandbox API key.
4. Generate a separate sandbox IPN secret. Save it once in the approved password
   manager; do not copy it into project files or messages.
5. Configure the Deploy Preview variables above with preview-only scope.
6. Keep `NOWPAYMENTS_ENABLED=false` for the first preview deployment.
7. Verify the preview webhook route exists and safely rejects unsigned requests.
8. Apply `20261018000000_nowpayments.sql` only to the disposable sandbox database.
9. After explicit approval, set the preview flag to `true` and create one emulated
   sandbox invoice. Never reuse sandbox secrets or records in production.

## Preview acceptance checks

- Preview build is from the reviewed commit and does not publish production.
- Production deploy lock remains enabled.
- `GET /api/payments/nowpayments/webhook` returns `405`, not `404`.
- Disabled `POST` returns `503` without database writes.
- Missing/invalid signatures are rejected before database access.
- A signed non-final event does not activate a subscription.
- One signed confirmed event activates exactly once; replay reports duplicate.
- Renewal requires a new customer-initiated payment and extends exactly once.
- API keys and IPN secrets are absent from browser bundles, responses, and logs.

## Production order

1. Review and merge only after CI and sandbox verification pass.
2. Take and independently verify a fresh production backup.
3. Run a read-only production schema and migration-ledger preflight.
4. Obtain separate approval for the exact migration hash.
5. Apply the migration in a transaction and verify objects, grants, and RLS.
6. Deploy with `NOWPAYMENTS_ENABLED=false` and verify the webhook route.
7. Configure production secrets without displaying or exporting their values.
8. Obtain separate approval for a controlled provider test.
9. Enable production payments only after signed-IPN reconciliation passes.

## Rollback

1. Set `NOWPAYMENTS_ENABLED=false` and publish only with explicit authorization.
2. Confirm checkout is unavailable and the webhook fails closed.
3. Keep order, event, and transaction records for reconciliation and audit.
4. Restore the previous healthy Netlify deployment if application rollback is needed.
5. Do not drop the migration objects during an incident.
6. Rotate provider credentials only if compromise is suspected and separately approved.
7. Reconcile all provider-side in-flight payments before any later re-enable.
