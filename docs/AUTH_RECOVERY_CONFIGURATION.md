# AgentDesk AI password recovery configuration

AgentDesk AI uses Supabase Auth's official one-time recovery-link flow. The application calls `resetPasswordForEmail` with the exact `/auth/callback?next=/reset-password` destination, exchanges the callback authorization for a session, and permits `updateUser({ password })` only when the callback marker and signed JWT recovery authentication method are both present.

## Hosted Supabase settings

Before production release, verify these settings in the Supabase dashboard:

1. **Authentication → URL Configuration**
   - Set Site URL to the canonical HTTPS AgentDesk AI origin.
   - Keep only exact approved redirect URLs, including `https://getagentdeskai.com/auth/callback` for production recovery.
2. **Authentication → Email → SMTP Settings**
   - Use the verified Brevo transactional SMTP account only after provider approval.
   - Use a verified sender/domain and `AgentDesk AI` as the sender name.
   - Verify SPF, DKIM, and DMARC. Disable click rewriting/tracking for recovery links unless it is separately security-reviewed.
3. **Authentication → Email Templates → Reset password**
   - Set subject to `Reset your AgentDesk AI password`.
   - Install `supabase/templates/recovery.html`.
   - Keep `{{ .ConfirmationURL }}` unchanged. The active template does not render `{{ .Token }}` or `{{ .TokenHash }}`.
4. **Authentication → Email security**
   - Review the configured recovery-link expiry; do not publish a fixed duration unless it matches the production setting.
   - Keep email request and verification rate limits enabled. The UI also applies a 60-second resend cooldown.
   - Enable password-change security notifications where available.

## Delivery verification

Use an approved disposable account. Request one link, confirm sender authentication, complete the reset through the exact callback, confirm the old password fails and the new password succeeds, and confirm the same link cannot authorize a second password change. Also test an expired/invalid link and the enumeration-safe response for an unknown address. Live delivery is not verified merely by installing the template.
