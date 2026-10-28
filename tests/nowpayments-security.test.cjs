/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS security test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261018000000_nowpayments.sql"), "utf8");

function compile(file, imports, env = {}) {
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports,
    require(name) { if (name === "server-only") return {}; if (Object.hasOwn(imports, name)) return imports[name]; return require(name); },
    Request, Response, Headers, URL, TextDecoder, TextEncoder, Uint8Array, Buffer, AbortSignal, ReadableStream,
    setTimeout, clearTimeout,
    fetch: (...args) => context.fetchImpl(...args), fetchImpl: global.fetch,
    process: { env: { NODE_ENV: "test", ...env } }, console,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context, { filename: file });
  return { exports: compiledModule.exports, context };
}

const config = compile("lib/billing-config.ts", {}).exports;
const requestSecurity = compile("lib/request-security.ts", {}).exports;
const adminStub = { createBillingAdminClient() { throw new Error("not used"); } };
const payments = compile("lib/payments/nowpayments.ts", {
  "@/lib/billing-config": config,
  "@/lib/billing-server": adminStub,
  "./types": {},
}).exports;

test("NOWPayments signature is canonical, SHA-512, and timing-safe input validation rejects bad signatures", () => {
  const secret = "synthetic-ipn-secret";
  const first = { payment_status: "confirmed", nested: { z: 2, a: 1 }, payment_id: 7 };
  const reordered = { payment_id: 7, nested: { a: 1, z: 2 }, payment_status: "confirmed" };
  const signature = payments.signNowPaymentsPayload(first, secret);
  assert.equal(signature.length, 128);
  assert.equal(signature, payments.signNowPaymentsPayload(reordered, secret));
  assert.equal(payments.verifyNowPaymentsSignature(reordered, signature, secret), true);
  assert.equal(payments.verifyNowPaymentsSignature(reordered, "0".repeat(128), secret), false);
  assert.equal(payments.verifyNowPaymentsSignature(reordered, "bad", secret), false);
});

test("NOWPayments provider is disabled by default and checkout redirects are tightly allowlisted", () => {
  const provider = payments.createNowPaymentsProvider();
  assert.equal(provider.configured, false);
  assert.ok(provider.approvedRedirectOrigins.includes("https://sandbox.nowpayments.io"));
  assert.equal(payments.isSafeNowPaymentsCheckoutUrl("https://nowpayments.io/payment/123"), true);
  assert.equal(payments.isSafeNowPaymentsCheckoutUrl("https://invoice.nowpayments.io/123"), true);
  assert.equal(payments.isSafeNowPaymentsCheckoutUrl("https://sandbox.nowpayments.io/payment/123"), true);
  assert.equal(payments.isSafeNowPaymentsCheckoutUrl("https://nowpayments.io.evil.test/123"), false);
  assert.equal(payments.isSafeNowPaymentsCheckoutUrl("http://nowpayments.io/123"), false);
});

test("webhook rejects invalid signatures before database access and reconciles valid callbacks", async () => {
  const secret = "synthetic-ipn-secret";
  const payload = {
    payment_id: 12345, payment_status: "confirmed", order_id: "11111111-1111-4111-8111-111111111111",
    price_amount: 9, price_currency: "usd", updated_at: "2026-10-25T12:00:00.000Z",
  };
  let calls = 0;
  const billingServer = {
    billingJson(data, status = 200) { return Response.json(data, { status }); },
    createBillingAdminClient() { return { async rpc(name, args) {
      calls += 1;
      assert.equal(name, "billing_process_nowpayments_ipn");
      assert.equal(args.p_order_id, payload.order_id);
      assert.equal(args.p_price_amount, 9);
      return { data: { duplicate: false, activated: true }, error: null };
    } }; },
  };
  const route = compile("app/api/payments/nowpayments/webhook/route.ts", {
    "@/lib/billing-server": billingServer,
    "@/lib/payments/nowpayments": payments,
    "@/lib/request-security": requestSecurity,
  }, { NOWPAYMENTS_ENABLED: "true", NOWPAYMENTS_IPN_SECRET: secret }).exports;

  const invalid = await route.POST(new Request("https://example.com/api/payments/nowpayments/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-nowpayments-sig": "0".repeat(128) }, body: JSON.stringify(payload),
  }));
  assert.equal(invalid.status, 401);
  assert.equal(calls, 0);

  const signature = payments.signNowPaymentsPayload(payload, secret);
  const valid = await route.POST(new Request("https://example.com/api/payments/nowpayments/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-nowpayments-sig": signature }, body: JSON.stringify(payload),
  }));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { received: true, duplicate: false, activated: true });
  assert.equal(calls, 1);
});

test("webhook bounds streamed request bodies before signature or database work", async () => {
  let calls = 0;
  const route = compile("app/api/payments/nowpayments/webhook/route.ts", {
    "@/lib/billing-server": {
      billingJson(data, status = 200) { return Response.json(data, { status }); },
      createBillingAdminClient() { calls += 1; throw new Error("must not run"); },
    },
    "@/lib/payments/nowpayments": payments,
    "@/lib/request-security": requestSecurity,
  }, { NOWPAYMENTS_ENABLED: "true", NOWPAYMENTS_IPN_SECRET: "synthetic-ipn-secret" }).exports;
  const oversized = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(256_001));
    controller.close();
  } });
  const response = await route.POST(new Request("https://preview.example/api/payments/nowpayments/webhook", {
    method: "POST", headers: { "content-type": "application/json" }, body: oversized, duplex: "half",
  }));
  assert.equal(response.status, 413);
  assert.equal(calls, 0);
});

test("sandbox checkout creates a server-owned order and its signed IPN reconciles", async () => {
  const inserted = [];
  const updated = [];
  const chain = (result = { error: null }) => ({
    eq() { return this; },
    then(resolve) { resolve(result); },
  });
  const billingAdmin = {
    from(name) {
      assert.equal(name, "nowpayments_payment_orders");
      return {
        async insert(value) { inserted.push(value); return { error: null }; },
        update(value) { updated.push(value); return chain(); },
      };
    },
  };
  const providerModule = compile("lib/payments/nowpayments.ts", {
    "@/lib/billing-config": config,
    "@/lib/billing-server": { createBillingAdminClient() { return billingAdmin; } },
    "./types": {},
  }, {
    NOWPAYMENTS_ENABLED: "true",
    NOWPAYMENTS_API_ORIGIN: "https://api.sandbox.nowpayments.io",
    NOWPAYMENTS_API_KEY: "synthetic-sandbox-key",
    NOWPAYMENTS_IPN_SECRET: "synthetic-ipn-secret",
    AGENTDESK_APP_ORIGIN: "https://preview.example",
  });
  let invoiceRequest;
  providerModule.context.fetchImpl = async (url, init) => {
    invoiceRequest = { url, init, body: JSON.parse(init.body) };
    return Response.json({ id: "sandbox-invoice-1", invoice_url: "https://sandbox.nowpayments.io/payment/sandbox-invoice-1" });
  };
  const provider = providerModule.exports.createNowPaymentsProvider();
  assert.equal(provider.configured, true);
  const checkout = await provider.createCheckout({
    userId: "11111111-1111-4111-8111-111111111111",
    planCode: "starter",
    returnUrl: "https://preview.example/billing",
    autoRenew: false,
    billingPeriod: "monthly",
    renewal: false,
  });
  assert.equal(checkout.checkoutUrl, "https://sandbox.nowpayments.io/payment/sandbox-invoice-1");
  assert.equal(invoiceRequest.url, "https://api.sandbox.nowpayments.io/v1/invoice");
  assert.equal(invoiceRequest.init.headers["x-api-key"], "synthetic-sandbox-key");
  assert.equal(invoiceRequest.body.ipn_callback_url, "https://preview.example/api/payments/nowpayments/webhook");
  assert.equal(invoiceRequest.body.price_amount, 9);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].status, "creating");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].provider_invoice_id, "sandbox-invoice-1");
  assert.equal(updated[0].status, "waiting");

  let reconciled = 0;
  const webhook = compile("app/api/payments/nowpayments/webhook/route.ts", {
    "@/lib/billing-server": {
      billingJson(data, status = 200) { return Response.json(data, { status }); },
      createBillingAdminClient() { return { async rpc(name, args) {
        reconciled += 1;
        assert.equal(name, "billing_process_nowpayments_ipn");
        assert.equal(args.p_order_id, inserted[0].order_id);
        return { data: { duplicate: false, activated: true }, error: null };
      } }; },
    },
    "@/lib/payments/nowpayments": providerModule.exports,
    "@/lib/request-security": requestSecurity,
  }, { NOWPAYMENTS_ENABLED: "true", NOWPAYMENTS_IPN_SECRET: "synthetic-ipn-secret" }).exports;
  const payload = {
    payment_id: "sandbox-payment-1", payment_status: "confirmed", order_id: inserted[0].order_id,
    price_amount: 9, price_currency: "usd", updated_at: "2026-10-26T00:00:00.000Z",
  };
  const response = await webhook.POST(new Request("https://preview.example/api/payments/nowpayments/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-nowpayments-sig": providerModule.exports.signNowPaymentsPayload(payload, "synthetic-ipn-secret") },
    body: JSON.stringify(payload),
  }));
  assert.equal(response.status, 200);
  assert.equal(reconciled, 1);
});

test("database reconciliation validates server order values and activates each order at most once", () => {
  assert.match(migration, /nowpayments_payment_orders[\s\S]*amount_cents integer not null[\s\S]*currency text not null/i);
  assert.match(migration, /round\(p_price_amount \* 100\) <> v_order\.amount_cents/i);
  assert.match(migration, /p_status in \('confirmed','finished'\) and v_order\.activated_at is null/i);
  assert.match(migration, /v_order\.kind='renewal'[\s\S]*current_period_end[\s\S]*interval '1 month'/i);
  assert.match(migration, /provider_event_id=v_event_id/i);
  assert.match(migration, /revoke all on public\.nowpayments_payment_orders from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.billing_process_nowpayments_ipn[\s\S]*to service_role/i);
  assert.match(migration, /p_status='refunded'[\s\S]*status='past_due'/i);
  assert.doesNotMatch(migration, /p_status in \([^)]*failed[^)]*\)[\s\S]*update public\.subscriptions set plan_id/i);
});

test("billing UI describes NOWPayments renewal honestly and disables unsupported stored methods", () => {
  const api = fs.readFileSync(path.join(root, "app/api/billing/route.ts"), "utf8");
  const checkout = fs.readFileSync(path.join(root, "app/api/billing/checkout/route.ts"), "utf8");
  const page = fs.readFileSync(path.join(root, "app/billing/page.tsx"), "utf8");
  assert.match(api, /const renewalMode = paymentProvider\.name === "nowpayments" \? "customer_initiated"/);
  assert.match(api, /automaticChargingAvailable: false/);
  assert.match(api, /paymentMethodsAvailable: paymentProvider\.configured && paymentProvider\.name !== "nowpayments"/);
  assert.match(page, /each renewal requires a new confirmed crypto payment/);
  assert.match(page, /automatic wallet charging is not supported or verified/);
  assert.match(checkout, /customerInitiated \? body\.renewalConsent !== true : body\.autoRenew !== true/);
  assert.match(checkout, /autoRenew: !customerInitiated/);
  assert.match(page, /renewalConsent: true, autoRenew: false/);
  assert.match(page, /Renew \$\{plan\.name\}/);
});

test("renewal notices cover pending, failed, expired, due, and past-due states without sending messages", () => {
  const renewal = compile("lib/billing-renewal.ts", {}).exports;
  const active = { status: "active", plan_id: "starter", current_period_end: "2026-11-05T00:00:00.000Z", cancel_at_period_end: false };
  assert.deepEqual(JSON.parse(JSON.stringify(renewal.buildBillingNotices(active, { status: "waiting", kind: "renewal", created_at: "2026-11-01T00:00:00.000Z" }, new Date("2026-11-01T00:00:00.000Z")).map((item) => item.code))), ["payment_pending", "renewal_due"]);
  assert.equal(renewal.buildBillingNotices(active, { status: "failed", kind: "renewal", created_at: "2026-11-01T00:00:00.000Z" }, new Date("2026-10-01T00:00:00.000Z"))[0].code, "payment_failed");
  assert.equal(renewal.buildBillingNotices(active, { status: "expired", kind: "renewal", created_at: "2026-11-01T00:00:00.000Z" }, new Date("2026-10-01T00:00:00.000Z"))[0].code, "payment_expired");
  assert.equal(renewal.buildBillingNotices({ ...active, status: "past_due" }, null)[0].code, "subscription_past_due");
  assert.deepEqual(JSON.parse(JSON.stringify(renewal.buildBillingNotices({ ...active, cancel_at_period_end: true }, null))), []);
});
