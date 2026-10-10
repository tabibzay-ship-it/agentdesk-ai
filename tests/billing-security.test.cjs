/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS security test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261009000000_subscription_billing.sql"), "utf8");

function compile(file, imports) {
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports,
    require(name) { if (name === "server-only") return {}; if (Object.hasOwn(imports, name)) return imports[name]; return require(name); },
    Request, Response, Headers, URL, TextDecoder, TextEncoder, Uint8Array, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "test" } }, console,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context, { filename: file });
  return compiledModule.exports;
}

const config = compile("lib/billing-config.ts", {});
const requestSecurity = compile("lib/request-security.ts", {});
const disabledPayments = compile("lib/payments/provider.ts", {});
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

test("plan catalog has the approved configurable prices and limits", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(config.BILLING_PLANS)), {
    free: { code: "free", name: "Free", priceCents: 0, agentLimit: 1, monthlyResponseLimit: 100, description: "For testing your first customer-support agent." },
    starter: { code: "starter", name: "Starter", priceCents: 900, agentLimit: 3, monthlyResponseLimit: 2000, description: "For small teams ready to support more customers." },
    pro: { code: "pro", name: "Pro", priceCents: 2900, agentLimit: 10, monthlyResponseLimit: 10000, description: "For growing support operations." },
  });
});

test("migration creates free subscriptions without overwriting existing accounts", () => {
  assert.match(migration, /billing_ensure_free_subscription[\s\S]*insert into public\.subscriptions[\s\S]*values \(p_user_id, 'free', 'active'/i);
  assert.match(migration, /on conflict \(user_id\) do nothing/i);
  assert.match(migration, /insert into public\.usage_limits[\s\S]*'free', 100, 0/i);
});

test("subscription ownership and cross-account RLS are read-only for customers", () => {
  for (const table of ["subscriptions", "billing_events", "payment_transactions"]) {
    assert.match(migration, new RegExp(`policy ".+" on public\\.${table} for select to authenticated using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`, "i"));
  }
  assert.match(migration, /revoke all on public\.subscription_plans, public\.subscriptions, public\.billing_events, public\.payment_transactions from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /policy[^;]+for (insert|update|delete) to authenticated/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[^;]+to authenticated/i);
});

test("usage quota and expiration are enforced before the atomic reservation", () => {
  assert.match(migration, /current_period_end <= now\(\)[\s\S]*monthly_limit=100[\s\S]*security_reserve_ai_usage\(p_user_id\)/i);
  const chat = fs.readFileSync(path.join(root, "app/api/chat/route.ts"), "utf8");
  assert.match(chat, /billing_security_reserve_ai_usage/);
  assert.match(chat, /security_release_ai_usage/);
});

test("verified billing events are idempotent and cannot accept a browser user id", () => {
  assert.match(migration, /unique\(provider, provider_event_id\)/i);
  assert.match(migration, /if exists \(select 1 from public\.billing_events where provider=p_provider and provider_event_id=p_event_id\)/i);
  const signature = /billing_process_verified_event\(([\s\S]*?)\) returns jsonb/i.exec(migration)?.[1] || "";
  assert.doesNotMatch(signature, /p_user_id/i);
  assert.match(migration, /provider_customer_ref=p_customer_ref and provider_subscription_ref=p_subscription_ref/i);
});

test("paid checkout rejects unauthenticated and self-assigned plans", async () => {
  const checkout = compile("app/api/billing/checkout/route.ts", {
    "@/lib/billing-config": config,
    "@/lib/request-security": requestSecurity,
    "@/lib/payments/provider": disabledPayments,
    "@/lib/billing-server": {
      billingJson: json,
      async authenticateBillingRequest(request) {
        return request.headers.has("authorization") ? { user: { id: "account-a" }, admin: {} } : { response: json({ code: "UNAUTHORIZED" }, 401) };
      },
    },
  });
  const unauthenticated = await checkout.POST(new Request("https://example.com/api/billing/checkout", { method: "POST", body: JSON.stringify({ planCode: "pro" }) }));
  assert.equal(unauthenticated.status, 401);
  const free = await checkout.POST(new Request("https://example.com/api/billing/checkout", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ planCode: "free", priceCents: 0, userId: "account-b" }) }));
  assert.equal(free.status, 400);
  const paid = await checkout.POST(new Request("https://example.com/api/billing/checkout", { method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: JSON.stringify({ planCode: "pro", priceCents: 0, userId: "account-b" }) }));
  assert.equal(paid.status, 503);
  assert.equal((await paid.json()).code, "PAYMENT_PROVIDER_UNAVAILABLE");
});

test("missing provider and invalid webhook signatures fail before reconciliation", async () => {
  const unavailableWebhook = compile("app/api/billing/webhook/route.ts", {
    "@/lib/billing-server": { billingJson: json, createBillingAdminClient() { throw new Error("must not run"); } },
    "@/lib/payments/provider": disabledPayments,
  });
  assert.equal((await unavailableWebhook.POST(new Request("https://example.com/api/billing/webhook", { method: "POST", body: "{}" }))).status, 503);

  let reconciled = false;
  const invalidWebhook = compile("app/api/billing/webhook/route.ts", {
    "@/lib/billing-server": { billingJson: json, createBillingAdminClient() { reconciled = true; return {}; } },
    "@/lib/payments/provider": { PaymentProviderUnavailableError: disabledPayments.PaymentProviderUnavailableError, getPaymentProvider() { return { configured: true, async verifyWebhook() { throw new Error("invalid signature"); } }; } },
  });
  const response = await invalidWebhook.POST(new Request("https://example.com/api/billing/webhook", { method: "POST", body: "{}" }));
  assert.equal(response.status, 400);
  assert.equal(reconciled, false);
});

test("cancellation derives ownership from the verified session and awaits provider reconciliation", () => {
  const source = fs.readFileSync(path.join(root, "app/api/billing/cancel/route.ts"), "utf8");
  assert.match(source, /\.eq\("user_id", authentication\.user\.id\)/);
  assert.doesNotMatch(source, /request\.json|readJsonObject/);
  assert.match(source, /verified webhook/);
  assert.doesNotMatch(source, /\.update\(/);
});
