# Google OAuth setup for AgentDesk AI

## Current external blocker

On October 14, 2026, the signed-in Google Cloud `projectcreate` page required first-time country acceptance before project creation. Afghanistan was absent from the displayed country list. Do not select a different country and do not create an inaccurate billing profile. No Google Cloud project, OAuth client, or credential was created.

Use Google's official Cloud Console Help / Support Contact Troubleshooter to ask whether an Afghanistan-resident developer can complete non-billing Google Auth Platform onboarding. Creating OAuth credentials is blocked until Google provides a legitimate route.

## Exact production values (after Google resolves onboarding)

- Project display name: `AgentDesk AI Production OAuth`
- Audience: External; keep in testing until a real callback test passes
- Scopes: `openid`, `email`, `profile` only
- Web JavaScript origin: `https://getagentdeskai.com`
- Google authorized redirect URI: `https://cdynahtkwtcinjzmxjcs.supabase.co/auth/v1/callback`
- Supabase Site URL: `https://getagentdeskai.com`
- Supabase redirect allow-list entry: `https://getagentdeskai.com/auth/callback`

The Google redirect URI and application callback are different stages. Google returns to Supabase; Supabase then returns the PKCE code to the application callback.

## Secret handling and activation order

1. Create the Web application client only after owner approval.
2. Copy the Client ID and Client Secret directly into Supabase Dashboard → Authentication → Providers → Google. Never paste the secret into chat, a repository file, browser JavaScript, or a screenshot.
3. Keep `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false` until the Supabase provider and URL configuration are approved.
4. Test with an approved Google test user and confirm session creation, callback cleanup, account isolation, and the one-trial rule.
5. Enable the public feature flag only after the real test succeeds.

## Support request

Subject: Afghanistan missing from required Google Cloud country onboarding for non-billing OAuth project

I am legally resident in Afghanistan and need to create a Google Cloud project solely to configure a Google OAuth 2.0 Web application for my website, AgentDesk AI. The direct Google Cloud project creation page redirects my account to a required country-selection and Terms screen, but Afghanistan is not available in that country list.

I do not want to enroll in a paid service or enter false country or billing information. Please confirm whether an Afghanistan-resident developer may create a non-billing Google Cloud project for Google Auth Platform / OAuth 2.0, and provide the official onboarding route if one is available. If it is unavailable, please confirm the applicable restriction and whether there is an approved alternative process.

No OAuth client or Google Cloud project has been created through inaccurate information.
