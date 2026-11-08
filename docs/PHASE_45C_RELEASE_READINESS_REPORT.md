# AgentDesk AI Phase 45C release-readiness report

Report date: 2026-11-08 (Asia/Kabul)

Status: **PARTIAL — PRODUCTION DEPLOYMENT NO-GO**

No production deployment, deploy unlock, Git commit, push, AI activation,
payment activation, database write, or customer-record change was performed.

## Hosted authentication evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Password login | PASS | Owner entered the newly reset password locally; the approved synthetic alias reached `/dashboard`. |
| Protected dashboard | PASS | Authenticated dashboard rendered for the signed-in account. |
| Session persistence | PASS | Full browser refresh retained the authenticated dashboard. |
| Logout | PASS | Logout returned the browser to `/login`. |
| Reset request | PASS | One request was submitted for the approved synthetic Gmail alias; the UI applied its resend cooldown. |
| Reset email delivery | PASS | Gmail metadata search found the matching reset message; its body, link and token were not read. |
| Password change | PASS | Owner confirmed the reset submission and then completed a successful hosted login using the new password. |
| Single-use recovery link | BLOCKED | The original recovery link has not yet been re-opened to verify rejection. |
| Two-account sessions | PASS | Two owner-approved synthetic accounts were authenticated in separate Chrome profiles. |
| Own-tenant read/write | PASS | Account A created and read a uniquely named synthetic knowledge source; Account B read its own pre-existing source. |
| Cross-tenant reads | PASS | Account A did not receive Account B's source and Account B did not receive Account A's unique marker. |
| Cross-tenant writes (hosted UI) | PASS / FAIL-CLOSED | Foreign records were not returned to either client, so no foreign edit/delete control or identifier was available. |
| Cross-tenant writes (database RLS) | PASS | The reviewed database integration suite verifies authenticated cross-owner writes are rejected. No service-role bypass was used in the hosted test. |
| Synthetic marker cleanup | BLOCKED ON HOSTED VERSION | The current hosted UI returned `Could not delete this source.` The failure was traced to a direct browser DELETE that production intentionally denies. A local owner-scoped authenticated API fix is complete and verified, but has not been deployed. |

Session persistence after the new-password login also passed a full browser
refresh. No password, access token, refresh token, OTP, or recovery token was read,
captured, logged, or placed in the repository.

## Fresh local release gates

| Gate | Result |
| --- | --- |
| ESLint | PASS |
| TypeScript | PASS |
| Automated tests | 274 PASS, 0 FAIL, 0 SKIP (259 Node + 15 TypeScript) |
| Production build | PASS |
| Route generation | 54/54 PASS, including the new `/api/knowledge` handler |
| Secret/security scan | PASS; 286 candidate files |
| Production dependency audit | PASS; 0 vulnerabilities |
| `git diff --check` | PASS; line-ending notices only |

The production build used non-secret, fail-closed CI placeholders. It proves
build and route compatibility, not live production secret validity.

## Confirmed hosted knowledge-delete defect and local repair

Root cause is verified. The hardened production database grants browser users
SELECT and INSERT on `knowledge_sources`, but intentionally does not grant
UPDATE or DELETE. The hosted page attempted those privileged operations directly
from the browser, so RLS/grants rejected the delete. This was a fail-closed UI
integration defect, not a tenant-isolation failure.

The local repair adds `app/api/knowledge/route.ts`. PATCH and DELETE now:

- require a verified bearer session through `accountApi`;
- validate the source UUID and bounded input;
- use the server-only admin client;
- constrain every mutation by both source ID and authenticated `user_id`;
- return the same not-found result for foreign and nonexistent sources; and
- emit private, no-store responses.

`app/knowledge/page.tsx` now sends edit/delete requests to that authenticated
endpoint. No RLS policy, database grant, migration, production record or hosted
configuration was changed. Focused regression tests, TypeScript, ESLint, the
complete 274-test suite, secret scan and the 54-route production build all pass.
Hosted cleanup remains BLOCKED until this exact local fix receives scoped
commit/push and staging-deployment approval and passes an authenticated delete
test there.

## Production safety state

- Production migration ledger: 13/13 verified by the Phase 45B final
  read-only postflight.
- External AI: provider key revoked; database fail-closed controls verified;
  hosting disable flag was enforced by the Phase 45B hosted safety gate.
- NOWPayments: disabled by the Phase 45B hosted safety gate.
- Netlify deploy lock: enabled during the last hosted safety gate.
- Active production deploy remained the pre-release deploy; no deployment was
  initiated during Phase 45C.

A new Netlify read-only query did not return usable output in this run, so the
last independently successful hosted safety-gate evidence remains authoritative
and no claim of a newer hosted read-back is made.

## Git review and proposed scoped release commit

Reviewed tracked changes:

- `.gitignore`
- `eslint.config.mjs`
- `next.config.ts`
- `scripts/backup/Restore-ProductionDatabaseRamOnly.ps1`
- `supabase/plans/production-ledger-baseline.sql`
- `tests/production-database-backup-safety.test.cjs`
- `tests/production-database-backup-verification.test.cjs`
- `tests/production-ram-restore-safety.test.cjs`
- `tsconfig.json`

The tracked diff contains the local build-directory isolation, test-scoped
CommonJS lint treatment, verified recovery rehearsal controls, and guarded
ledger/index sentinels. No secret was detected and no production security rule
was weakened.

Proposed documentation scope consists of the Phase 44/45 reports under
`docs/` plus the root Phase 45 completion report. The `.tmp-e2e/` directory is
operational scratch tooling/evidence and must remain excluded from the release
commit unless each file receives a separate explicit review.

At the time this evidence report was prepared, no files had yet been staged,
committed, or pushed. The owner subsequently authorized a commit and push
limited to the two knowledge implementation files, their regression test, and
this report. Staging deployment remains a separate approval boundary.

## Completion and decision

The conservative scoring remains:

- Phase 45A: 100.00%
- Phase 45B: 100.00%
- Phase 45C: 5/11 = 45.45% (additional hosted sub-gates passed, but the same
  five complete top-level requirements remain)
- Phase 45D: 0.00%
- Overall Phase 45: **61.36% verified**

The successful login/session/logout evidence materially reduces risk but does
not complete the combined password-reset acceptance requirement or the hosted
two-account isolation requirement.

**Deployment readiness: NO-GO.**

## Exact remaining owner actions

1. Complete the password-reset form for the approved synthetic staging account
   locally. The reset request and inbox delivery already passed. Open the email,
   follow its link, and perform the final password submission without sharing
   the password or token in chat. Then verify the new password login and that
   the recovery link cannot be reused.
2. Re-open the original reset link once and verify it is rejected as used or
   expired. Also verify the previous password is rejected; perform both actions
   locally without sharing either secret.
3. Separately approve a staging-only deployment of the scoped knowledge fix;
   then delete the
   single Account A marker and verify Account B remains signed in.
4. Production deployment remains a later, separate approval after all hosted
   acceptance gates pass.
