# AgentDesk AI release-candidate manifest

Status: **local preparation only**. This manifest does not authorize staging, a commit, a push, a pull request, a database migration, or a deployment.

## Snapshot

- Source branch: `codex/application-readiness`
- Source commit before the uncommitted release work: `49e807c3d88abec65ca29492318e819db69b26c8`
- Compared production branch: `origin/main` at `c5ca4409f0663ed2d079b79d9ac0f61a36ebda43`
- Branch delta at that snapshot: 158 files changed, 11,493 insertions, 1,423 deletions
- Staged files when this manifest was prepared: 0
- Production site: existing Netlify site `93173397-e520-44cf-89f8-7476b1ade538`

The working tree already contained extensive application, migration, test, and documentation work. Nothing in this preparation may be discarded or silently replaced. Review the commit range and every uncommitted file before staging.

## Password-recovery contract

The active flow is link based:

1. `/forgot-password` calls `resetPasswordForEmail` with the exact `/auth/callback?next=/reset-password` destination.
2. `supabase/templates/recovery.html` renders `{{ .ConfirmationURL }}`.
3. `/auth/callback` exchanges the Supabase authorization and records a verified recovery callback marker.
4. `/reset-password` also requires signed recovery authorization before calling the official password-update API.

`/verify-reset-code` remains in the repository as an inactive legacy/compatibility route and is not the flow linked from `/forgot-password`. Production instructions must not request a six-digit `{{ .Token }}` template unless the application is intentionally redesigned and reverified in a separate change.

## Proposed uncommitted release scope

These are the exact current working-tree paths proposed for review and eventual staging. Staging is deliberately not performed by this task.

### Application and runtime source

- `app/admin/page.tsx`
- `app/api/admin/route.ts`
- `app/api/chat/route.ts`
- `app/api/conversations/route.ts`
- `app/auth/callback/page.tsx`
- `app/chat/page.tsx`
- `app/conversations/page.tsx`
- `app/forgot-password/page.tsx`
- `app/reset-password/page.tsx`
- `app/verify-reset-code/page.tsx`
- `lib/client-security.ts`
- `lib/installation-verification.ts`
- `lib/origin-security.ts`
- `lib/recovery-flow.ts`
- `public/widget.js`

### Configuration

- `eslint.config.mjs`
- `package.json`
- `playwright.auth-ui-local.config.ts`
- `playwright.admin-responsive.config.ts`
- `playwright.chat-local.config.ts`
- `playwright.public-responsive.config.ts`
- `supabase/config.toml`

### Database migrations

- `supabase/migrations/20261013000000_marketing_consent.sql`
- `supabase/migrations/20261015000000_conversation_history.sql`
- `supabase/migrations/20261016000000_chat_request_idempotency.sql`
- `supabase/migrations/20261017000000_ai_credit_controls.sql`

The complete migration directory contains 12 ordered files, but that does **not** mean all 12 should be applied to production. Before any production write, compare the live schema and migration ledger through a fresh authorized read-only preflight. Apply only the proven missing migrations, in filename order, after approving their exact hashes and recovery checkpoint. Never apply the staging baseline to production.

### Password recovery and release documentation

- `docs/AUTH_RECOVERY_CONFIGURATION.md`
- `docs/FINAL_PRODUCTION_LAUNCH_CHECKLIST.md`
- `docs/PRODUCTION_AUTH_CHANGESET.md`
- `docs/PRODUCTION_AUTH_RECOVERY_CONFIGURATION.md`
- `docs/PRODUCTION_DEPLOYMENT.md`
- `docs/SUPABASE_RECOVERY_OTP_SETUP.md`
- `docs/RELEASE_CANDIDATE_MANIFEST.md`
- `supabase/templates/recovery.html`

### Tests

- `tests/admin-security.test.cjs`
- `tests/auth-regression.test.cjs`
- `tests/billing-security.test.cjs`
- `tests/e2e/admin-responsive.spec.ts`
- `tests/e2e/auth-local-live.spec.ts`
- `tests/e2e/auth-responsive.spec.ts`
- `tests/e2e/chat-isolated.spec.ts`
- `tests/marketing-consent-database.test.cjs`
- `tests/premium-completion.test.cjs`
- `tests/recovery-otp.test.cjs`
- `tests/security-chat.test.cjs`
- `tests/three-modules-regression.test.cjs`
- `tests/trial-recurring-social.test.cjs`
- `tests/ai-credit-controls-database.test.cjs`
- `tests/chat-idempotency-database.test.cjs`
- `tests/conversation-history.test.cjs`
- `tests/sql/ai-credit-controls-pg17.sql`
- `tests/sql/chat-credit-isolation-pg17.sql`

## Explicit exclusions

Do not stage, archive into the release, upload, or deploy any of the following:

- `.recovery-tools/` — local recovery tooling/runtime material, including large artifacts
- `.tmp-e2e/` — disposable E2E runtime and generated artifacts
- `Reasonix-Test/` — unrelated project
- `debug.log` — local diagnostic output
- `scripts/backup-recovery-archive.py` — local recovery/backup utility outside the application release scope
- `scripts/repair-backup-recovery.ps1` — local recovery/backup utility outside the application release scope
- `.env*`, credentials, keys, recovery escrows, database dumps, storage exports, or backup archives
- installer binaries, disk images, test downloads, screenshots, traces, coverage, and build output
- any file from unrelated projects or from drives `D:`, `E:`, or `F:`

This list protects release scope; it does not authorize deleting, moving, or editing any excluded file.

## Required pre-merge evidence

- `git diff --check`
- TypeScript typecheck
- ESLint
- password-recovery regression tests
- relevant security regression tests
- production build
- final secret/artifact review of the proposed staged set
- GitHub `Production quality gate / verify` after a separately authorized push

## Unresolved production dependencies

- Fresh read-only production schema and migration-ledger comparison; the ledger was previously reported incomplete.
- Fresh independently recoverable production backup checkpoint before any migration.
- Separate approval for each exact production migration hash and executor privileges, including the `auth.users` trigger requirement.
- Supabase Site URL/redirect and recovery-template changes, Brevo sender/domain authentication, and one real disposable-mailbox recovery test.
- Production environment-variable presence/scope validation without exposing values.
- A separately authorized quota-bounded OpenAI production smoke test; no automatic retry.
- Lawful payment provider/merchant account plus sandbox webhook evidence before checkout remains enabled.
- Google/Facebook OAuth remain disabled until legitimate provider onboarding and real callback tests pass.
- Separate approvals for Git push, pull-request creation, merge, production migrations, and Netlify deployment.

## Proposed pull-request description

### Summary

Prepare the existing AgentDesk AI application for a controlled production release. This release consolidates the reviewed application, security, tenant-isolation, conversation-history, AI-credit-control, responsive UI, and deployment-readiness work. Password-recovery documentation now matches the implemented Supabase one-time recovery-link flow using `{{ .ConfirmationURL }}`.

### Verification

- Local TypeScript, ESLint, focused authentication/security tests, production build, and diff-integrity results must be attached from the final clean run.
- PostgreSQL 17 migration and authenticated browser evidence remain referenced separately; production behavior is not inferred from local tests.

### Deployment notes

- Do not let CI or Netlify apply database migrations.
- Run a fresh read-only production schema/ledger preflight and approve only actually missing migration hashes.
- Complete the backup/recovery checkpoint before database changes.
- Apply authorized migrations before deploying application code that depends on them.
- Keep paid AI, payment checkout, and unverified OAuth providers disabled.
- Use the existing Netlify site and `main` branch; do not create a replacement site.

### Rollback

- Application: republish the last verified Netlify deploy or merge a reviewed revert.
- Database: use only a reviewed compensating migration or the independently verified restore procedure; never delete ledger rows or manually rewrite customer balances.
