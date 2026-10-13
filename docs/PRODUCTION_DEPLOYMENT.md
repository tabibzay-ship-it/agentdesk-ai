# AgentDesk AI production deployment

## Invariants

- Production domain: `https://getagentdeskai.com`
- `https://www.getagentdeskai.com` redirects to the apex domain.
- Production branch: `main`
- Existing Netlify site ID: `93173397-e520-44cf-89f8-7476b1ade538`
- Do not create a second Netlify site or change the primary domain.

## Required account configuration

1. Keep the existing Netlify site linked to GitHub repository `tabibzay-ship-it/agentdesk-ai` and production branch `main`.
2. Keep automatic production deploys enabled for `main`; use Deploy Previews for pull requests.
3. Keep the build command `npm run build:netlify`. Failed checks or builds then stop the deploy before publication.
4. Require the GitHub `verify` status check on `main` after the workflow has completed successfully on a pull request.
5. Keep these variable names configured in Netlify without copying values into GitHub or source control:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `AGENTDESK_APP_ORIGIN=https://getagentdeskai.com`
   - Existing billing-provider variables, if billing is enabled

## Normal release

1. Create a feature branch from current `main`.
2. Commit only reviewed changes; never commit `.env.local`, Netlify state, Supabase temporary files, test output, or backups.
3. Run `npm run verify:deploy` and `npm run build` locally.
4. Open a pull request to `main` and wait for the `verify` quality gate.
5. Merge only after approval. Netlify builds the commit and publishes only if `build:netlify` succeeds.
6. Run `npm run verify:production` and the safe authenticated checklist after Netlify reports success.

## Database migrations

Netlify and GitHub workflows must never apply Supabase migrations. Compare the production migration ledger with `supabase/migrations` using authorized read-only access. Apply pending migrations to staging first, take a documented backup, run database and security suites, and request explicit production authorization.

## Rollback

1. Stop further merges and record the failing commit and Netlify deploy ID.
2. In the existing Netlify site's Deploys page, select the last verified production deploy and use **Publish deploy**.
3. Alternatively, create a reviewed Git revert and merge it through the same quality gate.
4. Never reverse a database migration by deleting data. Use a reviewed compensating migration or restore procedure after explicit authorization.
5. Run `npm run verify:production` and the authenticated smoke checklist after rollback.

## Safe authenticated smoke checklist

Using dedicated test accounts, verify Dashboard, AI Chat without sending a paid provider request, Knowledge Base, Settings, Light/Dark/System, password recovery delivery, invalid or reused recovery links, and logout/login. Never use customer accounts or paid checkout during routine smoke tests.
