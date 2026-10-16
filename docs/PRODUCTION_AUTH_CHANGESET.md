# AgentDesk AI production Auth changeset

Status: **Prepared only. Do not apply without separate production approval.**

This is the smallest proposed Supabase Auth configuration change for the canonical production application.

## URL configuration

| Setting | Current production value | Proposed production value |
| --- | --- | --- |
| Site URL | `https://musical-sunflower-fb3106.netlify.app` | `https://getagentdeskai.com` |
| Redirect allowlist | `https://musical-sunflower-fb3106.netlify.app/**` | `https://getagentdeskai.com/auth/callback` |

The password recovery flow uses an emailed OTP and does not require a password-reset redirect URL. The `www` hostname redirects to the canonical apex hostname, so it is not included in the allowlist. Preview and localhost wildcards are intentionally excluded from the production project.

Rollback: restore the two current values shown above. This changes Auth routing only; it does not modify users or database records.

## Recovery email template

- Template: **Reset password**
- Subject: `Your AgentDesk AI password reset code`
- Body source: `supabase/templates/recovery.html`
- Required variable: `{{ .Token }}`
- Disallowed in this OTP flow: `{{ .ConfirmationURL }}`

The reviewed template contains AgentDesk AI branding, explains that the code is single-use, avoids password transmission, and does not embed tracking links. Installing it and testing real delivery require separate approval. SMTP sender verification, SPF, DKIM, DMARC, OTP expiry, and the actual delivery path must be verified independently before release.
