/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS regression harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("registration records an explicit optional marketing choice and supports safe verification resend", () => {
  const page = source("app/register/page.tsx");
  assert.match(page, /marketing_consent:\s*marketingConsent/);
  assert.match(page, /type:\s*"signup"/);
  assert.match(page, /emailRedirectTo:\s*`\$\{window\.location\.origin\}\/auth\/callback\?next=%2Fdashboard`/);
  assert.match(page, /error\?\.status === 429/);
  assert.doesNotMatch(page, /marketingConsent[^\n]+required/);
});

test("marketing consent migration is auditable and unavailable to browser roles", () => {
  const migration = source("supabase/migrations/20261013000000_marketing_consent.sql");
  assert.match(migration, /marketing_preferences/);
  assert.match(migration, /marketing_consent_events/);
  assert.match(migration, /after insert on auth\.users/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /revoke all[^;]+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete|all)[^;]+to authenticated/i);
  assert.match(migration, /grant execute on function public\.set_marketing_consent[^;]+to service_role/i);
  const api = source("app/api/marketing-consent/route.ts");
  assert.match(api, /p_user_id:\s*auth\.user\.id/);
  assert.doesNotMatch(api, /body\.userId|body\.user_id/);
});

test("provider-ready billing controls remain disabled until a provider is configured", () => {
  const page = source("app/billing/page.tsx");
  const provider = source("lib/payments/provider.ts");
  assert.match(page, /startCheckout/);
  assert.match(page, /cancelSubscription/);
  assert.match(page, /!data\.checkout\.available/);
  assert.match(provider, /name:\s*"disabled"/);
  assert.match(provider, /configured:\s*false/);
});

test("deployment quality gate runs database tests and the production Webpack build", () => {
  const workflow = source(".github/workflows/quality-gate.yml");
  const manifest = JSON.parse(source("package.json"));

  assert.match(workflow, /jobs:\s*[\s\S]*?verify:/);
  assert.match(workflow, /AGENTDESK_PGLITE_ROOT:\s*\$\{\{ github\.workspace \}\}/);
  assert.match(workflow, /npm run verify:deploy/);
  assert.match(workflow, /npm run build/);
  assert.equal(manifest.scripts.build, "next build --webpack");
  assert.equal(manifest.scripts.dev, "next dev --webpack");
  assert.equal(manifest.type, "module", "Next.js ESM source must not be declared as CommonJS");
  assert.equal(manifest.scripts["build:netlify"], "npm run verify:deploy && npm run build");
  assert.ok(manifest.devDependencies["@electric-sql/pglite"]);
});

test("production deployment validation pins the canonical site and Supabase project", () => {
  const validator = source("scripts/check-deployment-env.mjs");
  assert.match(validator, /CONTEXT === "production"/);
  assert.match(validator, /getagentdeskai\.com/);
  assert.match(validator, /https:\/\/cdynahtkwtcinjzmxjcs\.supabase\.co/);
  assert.match(validator, /NEXT_PUBLIC_SUPABASE_URL must use the approved AgentDesk AI Supabase project/);
});

test("final launch checklist keeps external services disabled until separately verified", () => {
  const checklist = source("docs/FINAL_PRODUCTION_LAUNCH_CHECKLIST.md");
  for (const signal of [
    "Netlify release and rollback",
    "OpenAI activation",
    "Payment-provider activation",
    "SMTP and OAuth",
    "Monitoring and incident response",
  ]) assert.ok(checklist.includes(signal), `missing ${signal}`);
  assert.match(checklist, /Do not activate checkout/);
  assert.match(checklist, /NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false/);
  assert.match(checklist, /last verified Netlify deploy/);
});

test("AgentDesk lint excludes the separate Reasonix test project", () => {
  const config = source("eslint.config.mjs");
  assert.match(config, /"Reasonix-Test\/\*\*"/);
});

test("disposable Supabase publishes every host port on loopback only", () => {
  const compose = source("tests/runtime/supabase-e2e.override.yml");
  const published = [...compose.matchAll(/-\s+"([^"]+):\d+\/tcp"/g)].map(match => match[1]);
  assert.deepEqual(published, [
    "127.0.0.1:55421",
    "127.0.0.1:55424",
    "127.0.0.1:55432",
    "127.0.0.1:55433",
  ]);
  assert.doesNotMatch(compose, /"(?:0\.0\.0\.0|\[::\]):/);
});
