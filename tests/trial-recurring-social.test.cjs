/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261014000000_trial_recurring_payment_methods.sql");

test("trial is five days, 250 total credits, one claim per verified identity", () => {
  assert.match(migration, /trial_days integer not null default 5 check \(trial_days = 5\)/i);
  assert.match(migration, /trial_credit_limit integer not null default 250 check \(trial_credit_limit = 250\)/i);
  assert.match(migration, /email_confirmed_at is null/i);
  assert.match(migration, /trial_identity_claims[\s\S]*identity_hash text primary key/i);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*on conflict\(identity_hash\) do nothing/i);
  assert.match(migration, /v_user\.created_at < v_config\.trial_launch_at/i);
});

test("trial usage is separate from Free and exact reservations are refundable", () => {
  assert.match(migration, /trial_usage_reservations/i);
  assert.match(migration, /'entitlement_source','trial'/i);
  assert.match(migration, /billing_security_release_ai_usage\(p_user_id uuid, p_reservation_id uuid\)/i);
  assert.match(migration, /where id=p_reservation_id and user_id=p_user_id and released_at is null/i);
  assert.match(migration, /security_release_ai_usage\(p_user_id,p_reservation_id\)/i);
  assert.doesNotMatch(migration, /update public\.usage_limits set messages_used=.*trial/i);
});

test("payment metadata excludes raw card secrets and browser roles have no access", () => {
  const table = /create table if not exists public\.payment_methods \(([\s\S]*?)\n\);/i.exec(migration)?.[1] || "";
  for (const forbidden of ["card_number", "pan text", "cvv", "cvc"]) assert.doesNotMatch(table, new RegExp(forbidden, "i"));
  assert.match(migration, /provider_payment_method_ref text not null/i);
  assert.match(migration, /last4 text not null check \(last4 ~ '\^\[0-9\]\{4\}\$'\)/i);
  assert.match(migration, /revoke all on public\.billing_program_config, public\.trial_entitlements, public\.payment_methods from public, anon, authenticated/i);
});

test("subscriptions require explicit auto-renew consent and signed webhook reconciliation", () => {
  const checkout = read("app/api/billing/checkout/route.ts");
  const webhook = read("app/api/billing/webhook/route.ts");
  const cancel = read("app/api/billing/cancel/route.ts");
  assert.match(checkout, /body\.autoRenew !== true/);
  assert.match(checkout, /billingPeriod: "monthly"/);
  assert.match(webhook, /verifyWebhook\(rawBody/);
  assert.match(webhook, /billing_process_verified_event_v2/);
  assert.match(cancel, /\{ atPeriodEnd: true \}/);
});

test("OAuth providers are opt-in and callback destinations are sanitized", () => {
  const social = read("components/social-auth-buttons.tsx");
  const linking = read("components/social-identity-linking.tsx");
  const callback = read("app/auth/callback/page.tsx");
  assert.match(social, /NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"/);
  assert.match(social, /NEXT_PUBLIC_FACEBOOK_AUTH_ENABLED === "true"/);
  assert.match(social, /signInWithOAuth/);
  assert.match(social, /provider === "google" \? "openid email profile" : undefined/);
  assert.match(social, /safeAuthDestination/);
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /safeAuthCallbackDestination/);
  assert.match(callback, /const result = code[\s\S]*exchangeCodeForSession[\s\S]*accessToken && refreshToken[\s\S]*setSession[\s\S]*getSession/);
  assert.doesNotMatch(callback, /existing\.data\.session/);
  assert.match(linking, /linkIdentity/);
  assert.match(linking, /provider === "google" \? "openid email profile" : undefined/);
  assert.match(linking, /unlinkIdentity/);
  assert.match(linking, /identities\.length < 2/);
  assert.doesNotMatch(social + linking + callback, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
  const supabaseClient = read("lib/supabase.ts");
  assert.match(supabaseClient, /flowType: "pkce"/);
  assert.match(supabaseClient, /detectSessionInUrl: false/);
});

test("Google OAuth setup stays gated and public policy routes are prepared", () => {
  const envExample = read(".env.example");
  const setup = read("docs/GOOGLE_OAUTH_SETUP.md");
  const privacy = read("app/privacy/page.tsx");
  const terms = read("app/terms/page.tsx");
  assert.match(envExample, /NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false/);
  assert.match(setup, /cdynahtkwtcinjzmxjcs\.supabase\.co\/auth\/v1\/callback/);
  assert.match(setup, /Do not select a different country/i);
  assert.match(privacy, /Supabase[\s\S]*Netlify[\s\S]*OpenAI[\s\S]*Brevo/);
  assert.match(terms, /legal identity[\s\S]*governing law/i);
});
