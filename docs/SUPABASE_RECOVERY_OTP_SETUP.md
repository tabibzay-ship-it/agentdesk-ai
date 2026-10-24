# Supabase recovery link setup

The application uses Supabase Auth's official password-recovery flow:

1. `resetPasswordForEmail(email, { redirectTo })` sends the recovery email and points to the exact AgentDesk AI callback.
2. The recovery template renders the Supabase-generated `{{ .ConfirmationURL }}`.
3. `/auth/callback?next=/reset-password` exchanges the authorization and records the verified recovery callback in session storage.
4. `/reset-password` accepts password updates only when the callback marker is present and the signed JWT contains a recovery authentication-method reference.

The repository retains `/verify-reset-code` and its regression coverage as an inactive legacy/compatibility route. The current `/forgot-password` page does not send users to that route, and production documentation must not describe it as the active recovery experience.

## Hosted production project

No production setting is changed by this repository. In the Supabase Dashboard for the intended project:

1. Open **Authentication → Email Templates → Reset password**.
2. Set the subject to `Reset your AgentDesk AI password`.
3. Replace the template body with `supabase/templates/recovery.html`.
4. Confirm `https://getagentdeskai.com/auth/callback` is an exact allowed redirect.
5. Review the configured recovery-link expiry and email rate limits. The UI deliberately does not claim a fixed expiry duration.
6. Save only after separately authorizing the production template and URL changes.

The active template must contain `{{ .ConfirmationURL }}` and must not render `{{ .Token }}` or `{{ .TokenHash }}`. SMTP delivery remains dependent on the project's configured provider. Test expiry, single use, replay rejection, callback validation, and delivery with an approved disposable account before declaring live recovery successful.

## Local Supabase

When using the Supabase CLI, point `[auth.email.template.recovery]` in the local `supabase/config.toml` to `./supabase/templates/recovery.html`, then test through the local mail catcher. Do not reuse production credentials.
