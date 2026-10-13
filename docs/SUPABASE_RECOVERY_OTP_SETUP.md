# Supabase recovery OTP setup

The application uses Supabase Auth's official password-recovery flow:

1. `resetPasswordForEmail(email)` sends the recovery email.
2. The recovery template renders `{{ .Token }}` instead of a link.
3. `/verify-reset-code` calls `verifyOtp({ email, token, type: "recovery" })`.
4. `/reset-password` accepts password updates only when the verified JWT contains a `recovery` authentication-method reference.

## Hosted production project

No production setting is changed by this repository. In the Supabase Dashboard for the intended project:

1. Open **Authentication → Email Templates → Reset password**.
2. Set the subject to `Your AgentDesk AI password reset code`.
3. Replace the template body with `supabase/templates/recovery.html`.
4. Confirm the Auth email OTP length is configured to **6 digits**.
5. Review the configured OTP expiry and email rate limits. The UI deliberately does not claim a fixed expiry duration.
6. Save only after separately authorizing the production template change.

The template must contain `{{ .Token }}` and must not contain `{{ .ConfirmationURL }}`. SMTP delivery remains dependent on the project's configured provider. Test with an approved disposable account before declaring live delivery successful.

## Local Supabase

When using the Supabase CLI, point `[auth.email.template.recovery]` in the local `supabase/config.toml` to `./supabase/templates/recovery.html`, then test through the local mail catcher. Do not reuse production credentials.
