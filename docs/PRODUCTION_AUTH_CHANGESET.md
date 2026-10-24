# AgentDesk AI production Auth changeset

Status: **Prepared only. Do not apply without separate production approval.**

This is the smallest proposed Supabase Auth configuration change for the canonical production application.

## URL configuration

| Setting | Current production value | Proposed production value |
| --- | --- | --- |
| Site URL | `https://musical-sunflower-fb3106.netlify.app` | `https://getagentdeskai.com` |
| Redirect allowlist | `https://musical-sunflower-fb3106.netlify.app/**` | `https://getagentdeskai.com/auth/callback` |

The password recovery flow uses Supabase's one-time recovery link. The link returns to `/auth/callback?next=/reset-password`, so the exact production callback URL must be allowlisted. The `www` hostname redirects to the canonical apex hostname, so it is not included in the allowlist. Preview and localhost wildcards are intentionally excluded from the production project.

Rollback: restore the two current values shown above. This changes Auth routing only; it does not modify users or database records.

## Recovery email template

- Template: **Reset password**
- Subject: `Reset your AgentDesk AI password`
- Body source: `supabase/templates/recovery.html`
- Required variable: `{{ .ConfirmationURL }}`
- Not used by the active recovery template: `{{ .Token }}` and `{{ .TokenHash }}`

The reviewed template contains AgentDesk AI branding, presents the Supabase-generated recovery URL without adding tracking parameters, avoids password transmission, and does not expose tokens in logs. Installing it and testing real delivery require separate approval. SMTP sender verification, SPF, DKIM, DMARC, recovery-link expiry/single-use behavior, and the actual delivery path must be verified independently before release.
