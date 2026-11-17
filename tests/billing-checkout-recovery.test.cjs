/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function compile(file, imports, env = {}) {
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports,
    require(name) { if (name === "server-only") return {}; if (Object.hasOwn(imports, name)) return imports[name]; return require(name); },
    Request, Response, Headers, URL, TextDecoder, TextEncoder, Uint8Array, setTimeout, clearTimeout,
    process: { env: { NODE_ENV: "test", ...env } }, console,
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context, { filename: file });
  return { exports: compiledModule.exports, context };
}

const config = compile("lib/billing-config.ts", {}).exports;
const requestSecurity = compile("lib/request-security.ts", {}).exports;
const checkoutLogic = compile("lib/billing-checkout.ts", {}).exports;
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

const NOW = new Date();
// Timestamps are derived from the current time so the test does not rot: a
// hardcoded calendar date silently falls outside CHECKOUT_STALE_MS (2h) once
// the wall clock moves past it, which flips an in-flight checkout to "stale".
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const baseSubscription = {
  status: "active", plan_id: "free", pending_plan_id: null, provider: null,
  provider_customer_ref: null, provider_subscription_ref: null, updated_at: minutesAgo(1),
};

function subscription(overrides = {}) {
  return { ...baseSubscription, ...overrides };
}

/* ------------------------------------------------------------------ */
/* Pure decision logic                                                 */
/* ------------------------------------------------------------------ */

test("a failed or expired first checkout can be retried instead of locking the account", () => {
  const stuck = subscription({ status: "incomplete", pending_plan_id: "pro", provider: "nowpayments",
    provider_customer_ref: "old-order", provider_subscription_ref: "old-order", updated_at: daysAgo(10) });
  for (const status of ["failed", "expired", "api_error", "finished", "refunded"]) {
    const decision = checkoutLogic.decideCheckout(stuck, { status, kind: "initial", created_at: daysAgo(10) }, "pro", "nowpayments", NOW);
    assert.deepEqual(JSON.parse(JSON.stringify(decision)), { action: "initial", releaseStale: true }, status);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(
    checkoutLogic.decideCheckout(stuck, null, "pro", "nowpayments", NOW))), { action: "initial", releaseStale: true });
  // An invoice that is still "waiting" but older than the stale window is abandoned.
  assert.deepEqual(JSON.parse(JSON.stringify(checkoutLogic.decideCheckout(stuck,
    { status: "waiting", kind: "initial", created_at: "2026-10-01T00:00:00.000Z" }, "pro", "nowpayments", NOW))),
    { action: "initial", releaseStale: true });
});

test("a genuinely concurrent checkout is still rejected", () => {
  const pending = subscription({ status: "incomplete", pending_plan_id: "pro", provider: "nowpayments",
    provider_customer_ref: "order", provider_subscription_ref: "order", updated_at: minutesAgo(5) });
  for (const status of ["creating", "waiting", "confirming", "sending", "partially_paid"]) {
    assert.deepEqual(JSON.parse(JSON.stringify(checkoutLogic.decideCheckout(pending,
      { status, kind: "initial", created_at: minutesAgo(5) }, "pro", "nowpayments", NOW))),
      { action: "rejected", reason: "in_progress" }, status);
  }
  // A freshly claimed row with no provider order yet belongs to an in-flight request.
  const claimed = subscription({ status: "incomplete", pending_plan_id: null, updated_at: minutesAgo(0) });
  assert.deepEqual(JSON.parse(JSON.stringify(checkoutLogic.decideCheckout(claimed, null, "pro", "nowpayments", NOW))),
    { action: "rejected", reason: "in_progress" });
});

test("canceled, past-due, refunded, and free accounts may start a new payment", () => {
  for (const status of ["canceled", "past_due", "expired"]) {
    const decision = checkoutLogic.decideCheckout(subscription({ status, plan_id: "pro", provider: "nowpayments",
      provider_customer_ref: "old", provider_subscription_ref: "old" }), null, "pro", "nowpayments", NOW);
    assert.deepEqual(JSON.parse(JSON.stringify(decision)), { action: "initial", releaseStale: false }, status);
  }
  // A free account that still carries provider references from an old attempt is not blocked.
  assert.deepEqual(JSON.parse(JSON.stringify(checkoutLogic.decideCheckout(
    subscription({ provider: "nowpayments", provider_customer_ref: "old", provider_subscription_ref: "old" }),
    null, "starter", "nowpayments", NOW))), { action: "initial", releaseStale: false });
});

test("active same-plan renewals stay renewals and plan changes stay rejected", () => {
  const active = subscription({ status: "active", plan_id: "pro", provider: "nowpayments",
    provider_customer_ref: "order", provider_subscription_ref: "order" });
  assert.deepEqual(JSON.parse(JSON.stringify(checkoutLogic.decideCheckout(active, null, "pro", "nowpayments", NOW))), { action: "renewal" });
  assert.deepEqual(JSON.parse(JSON.stringify(checkoutLogic.decideCheckout(active, null, "starter", "nowpayments", NOW))),
    { action: "rejected", reason: "plan_change" });
});

test("billing return URLs prefer the configured HTTPS app origin", () => {
  assert.equal(checkoutLogic.resolveBillingReturnUrl("https://internal.preview/api/billing/checkout", "https://getagentdeskai.com"),
    "https://getagentdeskai.com/billing");
  assert.equal(checkoutLogic.resolveBillingReturnUrl("https://internal.preview/api/billing/checkout", "http://insecure.example"),
    "https://internal.preview/billing");
  assert.equal(checkoutLogic.resolveBillingReturnUrl("https://internal.preview/api/billing/checkout", "https://app.example/path"),
    "https://internal.preview/billing");
  assert.equal(checkoutLogic.resolveBillingReturnUrl("http://localhost:3000/api/billing/checkout"),
    "http://localhost:3000/billing");
});

/* ------------------------------------------------------------------ */
/* Route behaviour with a synthetic admin client                       */
/* ------------------------------------------------------------------ */

function createAdmin({ subscription: initialSubscription, order = null, providerDelay = 0 }) {
  const state = { subscription: { ...initialSubscription }, updates: [], providerCalls: 0 };
  function subscriptionsBuilder() {
    let mode = "read";
    let values = null;
    const filters = [];
    const builder = {
      select() { return builder; },
      update(next) { mode = "update"; values = next; return builder; },
      eq(column, value) { filters.push({ op: "eq", column, value }); return builder; },
      is(column, value) { filters.push({ op: "is", column, value }); return builder; },
      order() { return builder; },
      limit() { return builder; },
      async maybeSingle() { return { data: mode === "read" ? state.subscription : null, error: null }; },
      then(resolve) {
        if (mode === "read") return resolve({ data: [], error: null });
        for (const filter of filters) {
          if (filter.column === "updated_at" && state.subscription.updated_at !== filter.value) {
            return resolve({ data: [], error: null });
          }
          if (filter.column === "status" && state.subscription.status !== filter.value) {
            return resolve({ data: [], error: null });
          }
          if (filter.column === "pending_plan_id") {
            const expected = filter.op === "is" ? null : filter.value;
            if (state.subscription.pending_plan_id !== expected) return resolve({ data: [], error: null });
          }
        }
        Object.assign(state.subscription, values);
        state.updates.push({ ...values });
        return resolve({ data: [{ user_id: "account-a", updated_at: state.subscription.updated_at }], error: null });
      },
    };
    return builder;
  }
  const admin = {
    state,
    async rpc() { return { error: null }; },
    from(table) {
      if (table === "subscriptions") return subscriptionsBuilder();
      if (table === "nowpayments_payment_orders") {
        const builder = {
          select() { return builder; }, eq() { return builder; }, order() { return builder; }, limit() { return builder; },
          async maybeSingle() { return { data: order, error: null }; },
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  admin.delay = providerDelay;
  return admin;
}

function createCheckoutRoute(admin, provider, env = {}) {
  return compile("app/api/billing/checkout/route.ts", {
    "@/lib/billing-config": config,
    "@/lib/billing-checkout": checkoutLogic,
    "@/lib/request-security": requestSecurity,
    "@/lib/payments/provider": {
      PaymentProviderUnavailableError: class PaymentProviderUnavailableError extends Error {},
      isApprovedPaymentRedirect(candidate, value) {
        try { return new URL(value).protocol === "https:" && candidate.approvedRedirectOrigins.includes(new URL(value).origin); }
        catch { return false; }
      },
      getPaymentProvider() { return provider; },
    },
    "@/lib/billing-server": {
      billingJson: json,
      async authenticateBillingRequest() { return { user: { id: "account-a" }, admin }; },
    },
  }, env).exports;
}

function checkoutRequest(body = { planCode: "pro", renewalConsent: true, autoRenew: false }) {
  return new Request("https://internal.preview/api/billing/checkout", {
    method: "POST",
    headers: { authorization: "Bearer token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function nowPaymentsProvider({ onCheckout, delay = 0 } = {}) {
  return {
    name: "nowpayments", configured: true,
    approvedRedirectOrigins: ["https://nowpayments.io", "https://invoice.nowpayments.io"],
    async createCheckout(request) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (onCheckout) onCheckout(request);
      return { checkoutUrl: "https://nowpayments.io/payment/new-order", customerReference: "new-order", subscriptionReference: "new-order" };
    },
  };
}

test("an abandoned checkout is released and the retry records the new order", async () => {
  const admin = createAdmin({
    subscription: subscription({ status: "incomplete", plan_id: "free", pending_plan_id: "pro", provider: "nowpayments",
      provider_customer_ref: "old-order", provider_subscription_ref: "old-order", updated_at: daysAgo(10) }),
    order: { status: "expired", kind: "initial", created_at: daysAgo(10) },
  });
  let checkoutRequestSeen = null;
  const route = createCheckoutRoute(admin, nowPaymentsProvider({ onCheckout: (value) => { checkoutRequestSeen = value; } }),
    { AGENTDESK_APP_ORIGIN: "https://getagentdeskai.com" });

  const response = await route.POST(checkoutRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).checkoutUrl, "https://nowpayments.io/payment/new-order");

  const release = admin.state.updates.find((value) => value.provider === null);
  assert.ok(release, "the stale provider references must be cleared before retrying");
  assert.equal(release.pending_plan_id, null);
  assert.equal(admin.state.subscription.pending_plan_id, "pro");
  assert.equal(admin.state.subscription.status, "incomplete");
  assert.equal(admin.state.subscription.provider_customer_ref, "new-order");
  assert.equal(checkoutRequestSeen.returnUrl, "https://getagentdeskai.com/billing");
  assert.equal(checkoutRequestSeen.renewal, false);
});

test("a recent in-flight checkout returns 409 without calling the provider", async () => {
  let called = 0;
  const admin = createAdmin({
    subscription: subscription({ status: "incomplete", plan_id: "free", pending_plan_id: "pro", provider: "nowpayments",
      provider_customer_ref: "order", provider_subscription_ref: "order", updated_at: minutesAgo(1) }),
    order: { status: "waiting", kind: "initial", created_at: minutesAgo(1) },
  });
  const route = createCheckoutRoute(admin, nowPaymentsProvider({ onCheckout: () => { called += 1; } }));
  const response = await route.POST(checkoutRequest());
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "DUPLICATE_SUBSCRIPTION");
  assert.equal(called, 0);
});

test("an active subscriber cannot start a checkout for a different plan", async () => {
  let called = 0;
  const admin = createAdmin({
    subscription: subscription({ status: "active", plan_id: "pro", provider: "nowpayments",
      provider_customer_ref: "order", provider_subscription_ref: "order" }),
  });
  const route = createCheckoutRoute(admin, nowPaymentsProvider({ onCheckout: () => { called += 1; } }));
  const response = await route.POST(checkoutRequest({ planCode: "starter", renewalConsent: true, autoRenew: false }));
  assert.equal(response.status, 409);
  assert.equal(called, 0);
});

test("an active same-plan renewal does not rewrite the subscription to incomplete", async () => {
  const admin = createAdmin({
    subscription: subscription({ status: "active", plan_id: "pro", provider: "nowpayments",
      provider_customer_ref: "order", provider_subscription_ref: "order" }),
  });
  const route = createCheckoutRoute(admin, nowPaymentsProvider());
  const response = await route.POST(checkoutRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).renewal, true);
  assert.equal(admin.state.subscription.status, "active");
  assert.equal(admin.state.subscription.pending_plan_id, null);
  assert.equal(admin.state.updates.length, 1, "only the concurrency timestamp is touched");
});

test("two simultaneous checkout requests create at most one order", async () => {
  let called = 0;
  const admin = createAdmin({ subscription: subscription({ status: "active", plan_id: "free" }), providerDelay: 20 });
  const route = createCheckoutRoute(admin, nowPaymentsProvider({ delay: 20, onCheckout: () => { called += 1; } }));
  const [first, second] = await Promise.all([route.POST(checkoutRequest()), route.POST(checkoutRequest())]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(called, 1);
});

test("a provider outage releases the claim so the user can retry immediately", async () => {
  const admin = createAdmin({ subscription: subscription({ status: "active", plan_id: "free" }) });
  let attempts = 0;
  const route = createCheckoutRoute(admin, {
    name: "nowpayments", configured: true, approvedRedirectOrigins: ["https://nowpayments.io"],
    async createCheckout() {
      attempts += 1;
      if (attempts === 1) throw new Error("provider down");
      return { checkoutUrl: "https://nowpayments.io/payment/new-order", customerReference: "new-order", subscriptionReference: "new-order" };
    },
  });
  const failed = await route.POST(checkoutRequest());
  assert.equal(failed.status, 500);
  assert.equal(admin.state.subscription.status, "active");
  assert.equal(admin.state.subscription.pending_plan_id, null);

  const recovered = await route.POST(checkoutRequest());
  assert.equal(recovered.status, 200);
});

test("stored payment methods report unavailable for NOWPayments and never call the provider", async () => {
  let setupCalls = 0;
  const provider = {
    name: "nowpayments", configured: true,
    async createPaymentMethodSetup() { setupCalls += 1; throw new Error("must not run"); },
  };
  const paymentMethods = compile("lib/payments/provider.ts", {
    "./nowpayments": { createNowPaymentsProvider() { return provider; } },
  }).exports;
  const route = compile("app/api/billing/payment-methods/route.ts", {
    "@/lib/billing-checkout": checkoutLogic,
    "@/lib/request-security": requestSecurity,
    "@/lib/payments/provider": paymentMethods,
    "@/lib/billing-server": {
      billingJson: json,
      async authenticateBillingRequest() {
        return {
          user: { id: "account-a" },
          admin: {
            from() {
              const builder = {
                select() { return builder; }, eq() { return builder; }, order() { return builder; },
                then(resolve) { return resolve({ data: [], error: null }); },
              };
              return builder;
            },
          },
        };
      },
    },
  }).exports;

  const listed = await route.GET(new Request("https://app.example/api/billing/payment-methods"));
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).setupAvailable, false);

  const setup = await route.POST(new Request("https://app.example/api/billing/payment-methods", {
    method: "POST", headers: { authorization: "Bearer token", "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(setup.status, 503);
  assert.equal((await setup.json()).code, "PAYMENT_METHODS_UNSUPPORTED");
  assert.equal(setupCalls, 0);
});

test("the billing page disables plan changes while a paid plan is active", () => {
  const page = fs.readFileSync(path.join(root, "app/billing/page.tsx"), "utf8");
  assert.match(page, /const activePaidPlan = currentPlan !== "free" && data\?\.subscription\?\.status === "active"/);
  assert.match(page, /\(activePaidPlan && !selected\)/);
  assert.match(page, /Plan change unavailable/);
});
