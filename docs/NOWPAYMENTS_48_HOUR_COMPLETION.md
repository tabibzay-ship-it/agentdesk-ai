# NOWPayments 48-hour completion runbook

This runbook covers the remaining external verification needed before the
NOWPayments integration can be called 100% ready. It does not authorize a
deployment, migration, credential change, or payment.

## Critical path

### Hours 0-4: recovery custody and staging backup

1. The owner confirms two different, secure, absolute folders for the two age
   private identities. Neither location may be the repository, backup output
   folder, or a synced/public folder.
2. Generate the two identities interactively and keep each private identity in
   separate custody. Store only public recipients in the backup runner input.
3. Enter the staging-only database password through the hidden PowerShell
   prompt. Reject the production project reference `cdynahtkwtcinjzmxjcs`.
4. Stream the custom and schema-only dumps directly through age. Do not create a
   plaintext dump.
5. Verify ciphertext hashes and independently decrypt with each recipient into
   a disposable PostgreSQL 17 restore environment.

### Hours 4-12: schema reconciliation

1. Run privacy-preserving read-only staging inventory queries.
2. Compare schema objects and the migration ledger with all local migrations.
3. Record represented, pending, conflicting, and ledger-only migrations.
4. Prepare an exact staging migration order and rollback checkpoints.
5. Apply nothing until the owner separately approves the exact migration list.

### Hours 12-24: isolated Deploy Preview

1. Use a non-production Supabase project and preview-only credentials.
2. Set `NOWPAYMENTS_ENABLED=false` and
   `NOWPAYMENTS_API_ORIGIN=https://api.sandbox.nowpayments.io`.
3. The deployment validator must reject the production Supabase origin and the
   production NOWPayments API in a Deploy Preview.
4. Deploy only after separate authorization. Confirm the preview commit, route
   availability, production deploy lock, and absence of production publishing.
5. Verify unsigned webhook requests fail closed before enabling checkout.

### Hours 24-40: sandbox checkout and IPN

1. Create separate NOWPayments sandbox API and IPN credentials directly in the
   provider and hosting dashboards; never transmit them through chat or Git.
2. Obtain approval for one sandbox-only transaction simulation.
3. Enable NOWPayments only in the isolated preview.
4. Verify invoice creation, pending status, signed confirmation, exact-once
   activation, duplicate replay, invalid signature rejection, failure/expiry,
   refund behavior, and customer-initiated renewal.
5. Confirm no automatic wallet charging and no production endpoints or secrets.

### Hours 40-48: final evidence and rollback drill

1. Run security, TypeScript, ESLint, automated tests, database tests, and the
   Node.js 22 production build.
2. Confirm secrets are absent from browser assets and logs.
3. Exercise the documented disable-first rollback in the isolated preview.
4. Record PASS/FAIL/BLOCKED evidence for backup, reconciliation, preview,
   checkout, signed IPN, replay, and rollback.
5. Keep production disabled until a separate production authorization is given.

## Consolidated approvals still required

- Confirmation of two separate private-key custody folders.
- Permission to generate the two real age identities locally.
- Staging-only password entry and permission to run the encrypted staging backup.
- Approval of the exact staging migration reconciliation plan before applying it.
- Permission to configure preview-only Supabase and NOWPayments sandbox secrets.
- Permission to push/deploy an isolated Netlify Deploy Preview.
- Permission to enable NOWPayments in that preview and perform one sandbox test.

Production migration, production credentials, production deployment, and live
payment authorization are deliberately outside this checklist.

## Current evidence and external execution checklist

The independent local work is complete: preview configuration rejects the
production Supabase project and live NOWPayments API; the synthetic runner
covers successful confirmation, replay, invalid signature, partial payment,
failure, expiry, refund, and customer-initiated renewal; PostgreSQL-compatible
tests cover private grants and exact-once activation.

| Step | Required input/approval | Expected evidence | Rollback/stop condition |
| --- | --- | --- | --- |
| Recovery custody | Two independently recoverable encrypted storage destinations and approval to generate identities | Each private identity is independently readable; neither is in Git or the backup folder | Stop if either destination is unencrypted, unavailable, or on the same custody boundary |
| Staging backup | Hidden staging-only DB password and approval for a read-only remote backup | Two-recipient age ciphertext, hashes, archive listing, and two independent decrypt/restore results | Stop on identity mismatch, plaintext output, read error, or failed independent restore |
| Reconciliation | Approval to run read-only staging inventory; later, separate approval for the exact migration list | Every migration classified using `STAGING_MIGRATION_RECONCILIATION.md` | No ledger writes; stop on LEDGER_ONLY or PARTIAL_OR_CONFLICTING |
| Preview configuration | Preview-scoped staging publishable/service credentials; synthetic disabled OpenAI value; sandbox NOWPayments credentials kept disabled | Environment validator passes without production origins or credentials | Remove/disable preview-scoped values and keep `NOWPAYMENTS_ENABLED=false` |
| Preview deployment | Approval to push/deploy the reviewed branch | Exact commit preview, production lock unchanged, webhook GET 405 and disabled POST 503 | Cancel preview; do not publish production |
| Sandbox exercise | Approval for one sandbox-only test after preview isolation passes | Invoice, signed states, exact-once activation, replay, refund and renewal evidence | Set preview flag false; preserve audit records; revoke sandbox credentials if exposed |

Required Deploy Preview variables are:

- `NEXT_PUBLIC_SUPABASE_URL=https://koqlnjctqeaykhbqkyuj.supabase.co`
- staging-only `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- staging-only `SUPABASE_SERVICE_ROLE_KEY`
- a non-production disabled/test `OPENAI_API_KEY`
- `AGENTDESK_APP_ORIGIN` equal to the exact Deploy Preview HTTPS origin
- `NOWPAYMENTS_ENABLED=false`
- `NOWPAYMENTS_API_ORIGIN=https://api.sandbox.nowpayments.io`
- sandbox-only `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET` only immediately
  before an explicitly approved sandbox exercise

Secret values must be entered directly into Netlify's Deploy Preview scope and
must never be placed in this file, chat, Git, command history, or build logs.
