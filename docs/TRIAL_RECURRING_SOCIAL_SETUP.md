# Trial, recurring billing, and social authentication setup

This implementation is intentionally provider-disabled. Applying the migration alone cannot charge a card or activate a paid subscription.

## Local database

Apply `20261014000000_trial_recurring_payment_methods.sql` only after the existing security and subscription migrations. The migration starts the eligibility clock at apply time, so existing accounts do not receive a retroactive trial. A verified new account receives one five-day entitlement with 250 total credits. Trial usage is stored independently from the monthly Free allowance.

## Payment provider (future approval required)

Implement `PaymentProvider` in `lib/payments/provider.ts` with a provider's hosted checkout/setup pages. Never send card number or CVV through AgentDesk endpoints. The adapter must verify webhook signatures from the raw body, return stable event IDs, and map only verified provider references and display metadata. Enable the provider only after secret management, webhook replay tests, legal availability, currency/tax review, and a separately authorized production change.

Checkout requires explicit monthly auto-renew consent. Browser redirects never activate entitlements. Only a verified, idempotent webhook can update subscription or saved-method state. Cancellation is requested for period end and remains pending until a verified event confirms it.

## Google

1. In Google Cloud, create an OAuth web client and configure the Supabase callback URL shown in Supabase Dashboard → Authentication → Providers → Google.
2. Add `https://getagentdeskai.com` as the production JavaScript origin.
3. Add `https://cdynahtkwtcinjzmxjcs.supabase.co/auth/v1/callback` as the production Google redirect URI. Google redirects to Supabase first; `/auth/callback` is the subsequent application redirect.
4. Request only `openid`, `email`, and `profile`.
5. Enter the Google client ID/secret only in the Supabase Dashboard/provider secret store.
6. Add `http://localhost:3000/auth/callback` and the approved production callback to Supabase Authentication URL Configuration.
7. Set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` only in the intended environment after a real callback test.

## Facebook

1. Create a Meta app with Facebook Login and add the exact Supabase OAuth callback URL.
2. Configure the App ID/secret only in Supabase Dashboard → Authentication → Providers → Facebook.
3. Add the exact application callback URLs to Supabase Authentication URL Configuration.
4. Complete Meta's required app-review/privacy configuration before public use.
5. Set `NEXT_PUBLIC_FACEBOOK_AUTH_ENABLED=true` only after the provider is operational.

Manual identity linking requires an already authenticated session. Supabase can also automatically link a new OAuth identity to an existing account only when it can safely establish a verified, unique matching email; unverified-email matching is not accepted as an account-linking boundary. Trial claims use a SHA-256 digest of a Supabase-verified normalized email to prevent a second claim through a different OAuth identity without storing a second plaintext identity copy.
