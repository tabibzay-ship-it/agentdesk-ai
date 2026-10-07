/* eslint-disable @typescript-eslint/no-require-imports -- Node security test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const owner = "11111111-1111-4111-8111-111111111111";
const agent = "22222222-2222-4222-8222-222222222222";
const visitor = "33333333-3333-4333-8333-333333333333";
const reservation = "44444444-4444-4444-8444-444444444444";
const conversation = "55555555-5555-4555-8555-555555555555";

function compile(file, imports, logs = []) {
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports,
    require(name) { if (name === "server-only") return {}; if (Object.hasOwn(imports, name)) return imports[name]; return require(name); },
    Request, Response, Headers, URL, TextDecoder, TextEncoder, Uint8Array,
    setTimeout, clearTimeout, process: { env: { NODE_ENV: "production" } },
    console: { error(...args) { logs.push(args); } },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context, { filename: file });
  return compiledModule.exports;
}
const bodyHelper = compile("lib/request-security.ts", {});
const originHelper = compile("lib/origin-security.ts", {});

function fixture(options = {}) {
  const queries = [], rpcs = [], ai = [], logs = [];
  let clientOptions;
  const admin = {
    auth: { admin: { async getUserById(id) { queries.push({ table: "auth", id }); return { data: { user: { id } }, error: null }; } } },
    from(table) {
      const query = { table, op: "select", filters: [], values: null };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        order() { return builder; }, limit() { return builder; },
        insert(values) { query.op = "insert"; query.values = values; return builder; },
        single() { return result(); }, maybeSingle() { return result(); },
        then(resolve, reject) { return result().then(resolve, reject); },
      };
      async function result() {
        const operation = `${table}:${query.op}`;
        if (options.fail === operation) return { data: null, error: { message: "PRIVATE_ERROR_DETAILS" } };
        if (table === "agent_settings") return { data: options.notFound || query.filters[0]?.[1] !== agent ? null : { user_id: owner, public_agent_id: agent, is_active: true, allowed_domains: ["customer.example"], ...options.settings }, error: null };
        if (table === "business_profiles") return { data: { business_name: "Tenant one", description: "Public business data" }, error: null };
        if (table === "knowledge_sources") return { data: [{ title: "Products", content: "Tenant one catalog" }], error: null };
        if (table === "conversations") return { data: query.op === "select" && options.newConversation ? null : { id: conversation }, error: null };
        if (table === "messages" && query.op === "select") return { data: [{ role: "user", content: "Hello", created_at: "2026-10-07" }], error: null };
        return { data: null, error: null };
      }
      return builder;
    },
    async rpc(name, args) {
      rpcs.push({ name, args });
      if (name === "check_chat_rate_limit") return { data: !(args.p_visitor_id === "__agent_burst__" ? options.accountLimited : options.visitorLimited), error: options.rateError ? { message: "PRIVATE_ERROR_DETAILS" } : null };
      if (name === "security_reserve_ai_usage") return { data: { allowed: !options.monthlyLimited, reservation_id: reservation, period_start: "2026-10-01", plan: "free", used: 1, monthly_limit: 100, remaining: 99 }, error: null };
      if (name === "security_release_ai_usage") return { data: true, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  class OpenAI {
    constructor(config) { clientOptions = config; }
    responses = { create: async (args) => {
      ai.push(args);
      if (options.aiThrows) throw new Error("PRIVATE_ERROR_DETAILS");
      return { output_text: options.emptyReply ? "" : "Hello from tenant one" };
    } };
  }
  const route = compile("app/api/chat/route.ts", {
    openai: OpenAI,
    "@supabase/supabase-js": { createClient() { return admin; } },
    "next/server": { NextResponse: { json(data, init) { return Response.json(data, init); } } },
    "@/lib/origin-security": originHelper,
    "@/lib/request-security": bodyHelper,
  }, logs);
  const request = (overrides = {}, origin = "https://customer.example") => new Request("https://agentdesk.example/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", ...(origin !== undefined ? { Origin: origin } : {}) },
    body: JSON.stringify({ message: "Hello", agentId: agent, visitorId: visitor, ...overrides }),
  });
  return { route, request, queries, rpcs, ai, logs, clientOptions };
}

test("rejects malformed, scalar, null and oversized request bodies before database access", async () => {
  for (const body of ["{", "null", "[]", '"text"', JSON.stringify({ extra: "x".repeat(16_384) })]) {
    const f = fixture();
    const response = await f.route.POST(new Request("https://agentdesk.example/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
    assert.ok([400, 413].includes(response.status)); assert.equal(f.queries.length, 0); assert.equal(f.rpcs.length, 0);
  }
});
test("streamed body limit cannot be bypassed by omitted or forged Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(16_385))); controller.close(); } });
  await assert.rejects(bodyHelper.readJsonObject(new Request("https://example.com", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "2" }, body: stream, duplex: "half" })), error => error.status === 413);
});
test("rejects unsupported body types and insecure visitor capabilities", async () => {
  assert.equal(bodyHelper.isVisitorId(visitor), true); assert.equal(bodyHelper.isVisitorId(`dashboard-test-${visitor}`), true);
  for (const value of ["abc", "visitor-123-random", "", owner.replace("4111", "1111"), null]) assert.equal(bodyHelper.isVisitorId(value), false);
  const f = fixture(); assert.equal((await f.route.POST(f.request({ visitorId: "predictable" }))).status, 400); assert.equal(f.queries.length, 0);
  assert.equal((await f.route.POST(new Request("https://example.com", { method: "POST", body: "{}" }))).status, 415);
});
test("blocks opaque, malformed, unapproved and subdomain origins before usage and writes", async () => {
  for (const origin of ["null", "https://customer.example/path", "https://evil.example", "https://sub.customer.example"]) {
    const f = fixture(); const response = await f.route.POST(f.request({}, origin));
    assert.equal(response.status, 403); assert.equal(f.rpcs.length, 0); assert.equal(f.ai.length, 0);
    assert.equal(f.queries.filter(q => q.op === "insert").length, 0); assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});
test("internal account UUID cannot resolve as a Public Agent ID", async () => {
  const f = fixture(); assert.equal((await f.route.POST(f.request({ agentId: owner }))).status, 404); assert.equal(f.rpcs.length, 0);
  assert.deepEqual(f.queries[0].filters, [["public_agent_id", owner]]);
});
test("inactive or malformed active state fails closed", async () => {
  for (const is_active of [false, null]) { const f = fixture({ settings: { is_active } }); assert.equal((await f.route.POST(f.request())).status, 503); assert.equal(f.rpcs.length, 0); }
});
test("rotating visitor IDs cannot bypass the account rate bucket", async () => {
  const f = fixture({ accountLimited: true });
  assert.equal((await f.route.POST(f.request())).status, 429);
  assert.equal(f.rpcs.length, 1); assert.equal(f.rpcs[0].args.p_visitor_id, "__agent_burst__"); assert.equal(f.rpcs[0].args.p_agent_id, owner); assert.equal(f.ai.length, 0);
});
test("visitor, monthly and rate-system failures stop before AI and reservation writes", async () => {
  for (const options of [{ visitorLimited: true }, { monthlyLimited: true }, { rateError: true }]) {
    const f = fixture(options); const response = await f.route.POST(f.request()); assert.ok([429, 503].includes(response.status)); assert.equal(f.ai.length, 0); assert.equal(f.queries.filter(q => q.op === "insert").length, 0); assert.equal(f.rpcs.filter(r => r.name === "security_release_ai_usage").length, 0);
  }
});
test("every failure after reservation rolls back exactly that reservation", async () => {
  for (const options of [
    { fail: "business_profiles:select" }, { fail: "knowledge_sources:select" }, { fail: "conversations:select" },
    { fail: "conversations:insert", newConversation: true }, { fail: "messages:insert" }, { aiThrows: true }, { emptyReply: true },
  ]) {
    const f = fixture(options); assert.equal((await f.route.POST(f.request())).status, 500);
    const releases = f.rpcs.filter(r => r.name === "security_release_ai_usage"); assert.equal(releases.length, 1);
    assert.equal(releases[0].args.p_user_id, owner); assert.equal(releases[0].args.p_reservation_id, reservation);
    assert.ok(!JSON.stringify(f.logs).includes("PRIVATE_ERROR_DETAILS"));
  }
});
test("success uses only the resolved account and bounded provider options, without rollback", async () => {
  const f = fixture({ newConversation: true }); const response = await f.route.POST(f.request());
  assert.equal(response.status, 200); assert.equal((await response.json()).reply, "Hello from tenant one"); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://customer.example");
  for (const table of ["business_profiles", "knowledge_sources", "conversations"]) assert.ok(f.queries.filter(q => q.table === table && q.op === "select").every(q => q.filters.some(([k,v]) => k === "user_id" && v === owner)));
  assert.ok(f.queries.filter(q => q.table === "messages").every(q => q.op === "select" ? q.filters.some(([k,v]) => k === "conversation_id" && v === conversation) : q.values.conversation_id === conversation));
  assert.equal(f.rpcs.filter(r => r.name === "security_release_ai_usage").length, 0);
  assert.equal(f.ai[0].store, false); assert.equal(f.ai[0].max_output_tokens, 2_000); assert.equal(f.clientOptions.maxRetries, 0); assert.equal(f.clientOptions.timeout, 45_000);
});
test("preflight rejects opaque origins without database access", async () => {
  const f = fixture(); const response = await f.route.OPTIONS(new Request("https://agentdesk.example/api/chat", { method: "OPTIONS", headers: { Origin: "null" } })); assert.equal(response.status, 403); assert.equal(f.queries.length, 0);
});
