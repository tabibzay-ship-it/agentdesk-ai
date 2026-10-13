# AgentDesk AI production deployment

## Invariants

- Production domain: `https://getagentdeskai.com`
- `https://www.getagentdeskai.com` redirects to the apex domain.
- Production branch: `main`
- Existing Netlify site ID: `93173397-e520-44cf-89f8-7476b1ade538`
- Do not create a second Netlify site or change the primary domain.

## Required one-time account configuration

1. In the existing Netlify site, confirm Git provider `GitHub`, repository `tabibzay-ship-it/agentdesk-ai`, and production branch `main`.
2. Keep automatic production deploys enabled for `main` and Deploy Previews enabled only for non-production contexts.
3. Keep the build command from `netlify.toml`: `npm run build:netlify`. Failed checks or builds then fail the deploy before publication.
4. After the workflow has completed successfully on GitHub at least once, require the exact `Production quality gate / verify` status on `main`. Require pull requests with zero approving reviews for the solo maintainer, block force pushes and branch deletion, and configure no bypass users or applications.
5. In Netlify, keep these variable names configured for Production without copying values into GitHub or source control:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `AGENTDESK_APP_ORIGIN=https://getagentdeskai.com`
   - Existing billing-provider variables, if billing is enabled
6. Configure a Netlify deploy-success notification to run `npm run verify:production` from a trusted monitor or CI job. Authenticated smoke tests must use isolated test accounts and must not call paid AI or billing APIs.

## Normal release

1. Create a feature branch from current `main`.
2. Commit only reviewed changes; never commit `.env.local`, Netlify state, Supabase temporary files, test output, or backups.
3. Run `npm run verify:deploy` and `npm run build` locally.
4. Open a pull request to `main` and wait for the GitHub quality gate and review.
5. Merge the approved pull request. The existing Netlify Git integration builds the commit and publishes only if `build:netlify` succeeds.
6. Run `npm run verify:production` and the safe authenticated checklist after Netlify reports success.

## Activation order for externally blocked features

Each numbered item requires its own explicit authorization when it changes a production system.

1. Commit the reviewed workflow and application changes on a feature branch, push it, and confirm the GitHub `verify` job passes with no skipped database tests.
2. Activate the approved `main` ruleset only after GitHub has registered the exact required check. Confirm the repository owner can merge their own pull request after the check passes.
3. Revalidate the encrypted production backup and run read-only schema preflights. Apply only the separately approved pending migrations in dependency order: Super Admin, Leads/Appointments, then Marketing Consent. Never apply the staging baseline.
4. Create the administrator through the normal Supabase Auth flow, verify the user, provision the exact user ID through the controlled one-time database procedure, and enroll TOTP before using `/admin`.
5. Install the reviewed recovery OTP email template, verify the sender domain, SPF, DKIM and DMARC, then test delivery with an approved disposable recipient. Do not log OTP values.
6. Keep billing disabled until a lawful provider, webhook secret and server-side product mappings are approved. Rehearse signature, replay, cancellation and out-of-order-event handling before activation.
7. Run one explicitly authorized, quota-bounded AI inference test with synthetic content. Confirm usage reservation and refund behavior without customer data.
8. Merge through the protected branch and allow the existing Netlify site to build. Do not create another site or change DNS.
9. Run the public and authenticated smoke checks below, record the deploy ID, and monitor authentication, API errors, quota failures and webhook rejection rates.

## Database migrations

Netlify and GitHub workflows must never apply Supabase migrations. Before a release, compare the production migration ledger with `supabase/migrations` using authorized read-only access. Apply pending migrations to staging first, take the documented logical backup, run the database/security suites, and request explicit production authorization. Follow `docs/BILLING_MIGRATION_RUNBOOK.md` and `docs/PRODUCTION_BILLING_BACKUP_PLAN.md` for backup and recovery.

## Rollback

1. Stop further merges and record the failing commit and Netlify deploy ID.
2. In the existing Netlify site's Deploys page, select the last verified production deploy and use **Publish deploy**. This restores application code without changing DNS, environment variables, or Supabase data.
3. Alternatively, create a reviewed Git revert of the bad commit and merge it through the same quality gate.
4. Do not roll back a database migration by deleting data. Use only its reviewed compensating migration or restore procedure after explicit authorization.
5. Run `npm run verify:production` and the authenticated smoke checklist after rollback.

## Safe authenticated smoke checklist

Using only dedicated test accounts, verify Dashboard, AI Chat without sending a paid provider request, Knowledge Base, Settings, Light/Dark/System, password recovery delivery, incorrect/expired/reused recovery codes, and logout/login. Never use real customer accounts or paid checkout during routine smoke tests.
