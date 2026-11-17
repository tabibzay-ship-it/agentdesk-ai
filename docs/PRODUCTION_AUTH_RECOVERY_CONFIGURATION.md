# AgentDesk AI production password-recovery configuration

Preparation only. Do not apply these settings without separate production approval.

## Exact URL configuration

In the production Supabase project (`cdynahtkwtcinjzmxjcs`), set:

- Site URL: `https://getagentdeskai.com`
- Additional redirect URL: `https://getagentdeskai.com/auth/callback`

Use exact URLs. Do not add wildcard domains, Netlify preview domains, localhost,
IP addresses, or arbitrary `next` destinations to the production allowlist. The
application supplies `/auth/callback?next=/reset-password`; Supabase validates
the callback origin/path and the application independently allows only the exact
reset destination for recovery callbacks.

## Brevo SMTP preparation

1. Verify the AgentDesk AI sending domain and From address in Brevo.
2. Create or select a dedicated transactional SMTP credential with the minimum
   required sending access. Do not use the Brevo account password.
3. In Supabase Auth SMTP settings, enter the Brevo relay hostname, the Brevo
   SMTP username, the dedicated SMTP key, port `587`, and STARTTLS/TLS.
4. Use the verified AgentDesk AI sender name and address. Never place an SMTP
   key in source control, Netlify public variables, browser code, logs, or this
   runbook.
5. Keep Brevo click/open tracking disabled for recovery links unless a separate
   privacy and token-leakage review approves it.

## Recovery email template

- Subject: `Reset your AgentDesk AI password`
- Source file: `supabase/templates/recovery.html`
- The action button must use `{{ .ConfirmationURL }}` unchanged.
- Do not add the token, token hash, recipient address, or confirmation URL to
  analytics parameters, remote images, or logging links.

## Separately approved delivery verification

1. Use a dedicated, owner-controlled test mailbox that has never been used for
   customer data.
2. Request one reset from `/forgot-password` and verify the enumeration-safe UI.
3. Confirm SPF, DKIM, DMARC alignment and that the message arrives without a
   rewritten recovery URL.
4. Open the link once, set a new synthetic password, confirm the old password is
   rejected, then confirm the same link cannot authorize another change.
5. Repeat with an unknown synthetic address and verify that the public response
   is identical. Do not inspect provider logs for account existence.
6. Record only timestamps, delivery status, and sanitized error categories—never
   tokens, passwords, SMTP keys, or full recovery URLs.

## Rollback

Before changing production, record the existing Site URL, redirect entries,
sender identity, SMTP enabled state, and template revision without copying any
secret. If delivery fails, restore those non-secret values and disable the new
SMTP configuration; application and database deployment are not required for
this rollback.
