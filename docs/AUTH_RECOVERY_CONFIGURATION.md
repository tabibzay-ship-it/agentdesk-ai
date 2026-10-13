# AgentDesk AI password recovery configuration

AgentDesk AI uses Supabase Auth's official recovery OTP flow. The application requests recovery with `resetPasswordForEmail`, verifies the emailed code with `verifyOtp({ type: "recovery" })`, and permits `updateUser({ password })` only when the signed JWT contains the `recovery` authentication method.

## Hosted Supabase settings

Before production release, verify these settings in the Supabase dashboard:

1. **Authentication → URL Configuration**
   - Set Site URL to the canonical HTTPS AgentDesk AI origin.
   - Keep only exact approved redirect URLs. The code-based flow does not depend on a recovery-link redirect.
2. **Authentication → Email → SMTP Settings**
   - Use the verified Brevo transactional SMTP account only after provider approval.
   - Use a verified sender/domain and `AgentDesk AI` as the sender name.
   - Verify SPF, DKIM, and DMARC. Do not place authentication codes in tracked links.
3. **Authentication → Email Templates → Reset password**
   - Set subject to `Your AgentDesk AI password reset code`.
   - Install `supabase/templates/recovery.html`.
   - Keep `{{ .Token }}` and remove every `{{ .ConfirmationURL }}` reset link.
4. **Authentication → Email/OTP security**
   - Configure the recovery OTP length to six digits.
   - Review the actual OTP expiry. The application intentionally does not present a hardcoded expiry countdown.
   - Keep email and verification attempt rate limits enabled. The UI also applies a 60-second resend cooldown.
   - Enable password-change security notifications where available.

## Delivery verification

Use an approved disposable account. Request one code, confirm sender authentication, reject an incorrect code, complete the reset with the correct code, confirm the old password fails and the new password succeeds, and confirm the same code cannot be reused. Live delivery is not verified merely by installing the template.
