/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");

async function runTests() {

// Resolve installed dependencies from the project running npm test. This also
// lets the same tests verify a staged patch without reading environment files.
const projectRequire = createRequire(path.join(process.cwd(), "package.json"));
const ts = projectRequire("typescript");
const parse5 = await import(pathToFileURL(projectRequire.resolve("parse5")).href);
const repoRoot = path.resolve(__dirname, "..");
const accountId = "11111111-1111-4111-8111-111111111111";
const publicAgentId = "22222222-2222-4222-8222-222222222222";
const otherPublicAgentId = "33333333-3333-4333-8333-333333333333";
const widgetOrigin = "https://agentdesk.example";
const customerUrl = "https://customer.example/support";

function loadTypeScript(relativePath, imports = {}, env = {}) {
  let filename = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filename)) filename = path.join(process.cwd(), relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule,
    exports: compiledModule.exports,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      if (name === "server-only") return {};
      if (name === "parse5") return parse5;
      return projectRequire(name);
    },
    process: { env: { NODE_ENV: "production", AGENTDESK_APP_ORIGIN: widgetOrigin, ...env } },
    console: { error() {}, warn() {}, log() {} },
    Request,
    Response,
    Headers,
    URL,
    AbortSignal,
    TextDecoder,
    TextEncoder,
    Buffer,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(output, context, { filename });
  return compiledModule.exports;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture(options = {}) {
  const queries = [];
  const tokens = [];
  const fetches = [];
  const mutations = [];
  const rateChecks = [];
  const agent = {
    user_id: accountId,
    public_agent_id: publicAgentId,
    allowed_domains: [],
    is_active: true,
    ...options.agent,
  };
  const originalSettings = {
    user_id: accountId,
    agent_name: "Custom support team",
    welcome_message: "Welcome to our store",
    primary_color: "#aabbcc",
    is_installed: false,
  };
  let settings = options.missingSettings ? null : { ...originalSettings };
  const admin = {
    async rpc(name, args) {
      rateChecks.push({ name, args: plain(args) });
      return { data: options.rateDenied ? false : true, error: options.rateError ? { message: "Database-secret" } : null };
    },
    auth: {
      async getUser(token) {
        tokens.push(token);
        return options.unauthorized
          ? { data: { user: null }, error: { message: "Invalid token" } }
          : { data: { user: { id: accountId } }, error: null };
      },
    },
    from(table) {
      const query = { table, operation: "select", filters: [], values: null };
      queries.push(query);
      const builder = {
        select() { return builder; },
        eq(column, value) { query.filters.push([column, value]); return builder; },
        update(values) {
          query.operation = "update";
          query.values = plain(values);
          return builder;
        },
        insert(values) {
          query.operation = "insert";
          query.values = plain(values);
          return builder;
        },
        async maybeSingle() { return resolve(); },
        async single() { return resolve(); },
        then(onResolve, onReject) { return Promise.resolve(resolve()).then(onResolve, onReject); },
      };
      function resolve() {
        if (table === "agent_settings") {
          return { data: options.agentMissing ? null : agent, error: options.agentError ? { message: "Agent query failed" } : null };
        }
        if (table !== "widget_settings") throw new Error(`Unexpected table ${table}`);
        if (query.operation === "select") {
          return { data: settings, error: options.settingsError ? { message: "Settings query failed" } : null };
        }
        if (options.updateError || (options.insertError && query.operation === "insert")) return { data: null, error: { message: "Write failed" } };
        if (query.operation === "update" && !settings) return { data: null, error: null };
        settings = { ...(settings || {}), ...query.values };
        mutations.push(plain(query));
        return { data: { ...settings }, error: null };
      }
      return builder;
    },
  };
  const originSecurity = loadTypeScript("lib/origin-security.ts", {}, options.env);
  const helper = loadTypeScript("lib/installation-verification.ts");
  const verifier = {
    ...helper,
    async fetchInstallationPage(...args) {
      fetches.push(args);
      if (!args[1].isAllowed(args[0])) throw new helper.InstallationVerificationError("Domain is not allowed.", "ORIGIN_NOT_ALLOWED");
      if (options.fetchError) throw options.fetchError;
      if (options.fetchImpl) return options.fetchImpl(...args);
      return {
        html: options.html ?? `<script src="${widgetOrigin}/widget.js" data-agent-id="${publicAgentId}" async></script>`,
        url: new URL(options.finalUrl ?? customerUrl),
      };
    },
  };
  const route = loadTypeScript("app/api/verify-installation/route.ts", {
    "@supabase/supabase-js": { createClient() { return admin; } },
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/origin-security": originSecurity,
    "@/lib/installation-verification": verifier,
    "@/lib/request-security": loadTypeScript("lib/request-security.ts"),
  }, options.env);
  return {
    queries,
    tokens,
    fetches,
    mutations,
    rateChecks,
    originalSettings,
    get settings() { return settings; },
    async request(body = { websiteUrl: customerUrl }, authorization = "Bearer valid-test-token", raw = false) {
      const headers = { "content-type": "application/json", ...options.headers };
      if (authorization !== null) headers.authorization = authorization;
      const response = await route.POST(new Request(`${options.requestOrigin ?? widgetOrigin}/api/verify-installation`, {
        method: "POST",
        headers,
        body: raw ? body : JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("requires a nonempty, valid bearer token before any query or website fetch", async (t) => {
  for (const authorization of [null, "", "Basic abc", "Bearer", "Bearer ", "Bearer token unexpected"]) {
    await t.test(JSON.stringify(authorization), async () => {
      const f = fixture();
      const result = await f.request(undefined, authorization);
      assert.equal(result.status, 401);
      assert.notEqual(result.body.verified, true);
      assert.equal(f.queries.length, 0);
      assert.equal(f.fetches.length, 0);
    });
  }
  const f = fixture({ unauthorized: true });
  assert.equal((await f.request()).status, 401);
  assert.equal(f.queries.length, 0);
  assert.equal(f.fetches.length, 0);
});

test("rejects invalid JSON and non-object or missing website URL bodies", async (t) => {
  for (const body of [null, [], {}, { websiteUrl: 123 }, { websiteUrl: " " }]) {
    await t.test(JSON.stringify(body), async () => {
      const f = fixture();
      assert.equal((await f.request(body)).status, 400);
      assert.equal(f.mutations.length, 0);
      assert.equal(f.fetches.length, 0);
    });
  }
  const f = fixture();
  assert.equal((await f.request("{invalid json", undefined, true)).status, 400);
  assert.equal(f.mutations.length, 0);
});

test("authenticates account ownership and ignores caller supplied user and agent IDs", async () => {
  const f = fixture();
  const result = await f.request({ websiteUrl: customerUrl, userId: "another-account", publicAgentId: otherPublicAgentId });
  assert.equal(result.status, 200);
  assert.equal(result.body.verified, true);
  assert.deepEqual(f.tokens, ["valid-test-token"]);
  for (const query of f.queries.filter((q) => q.operation !== "insert")) {
    assert.ok(query.filters.some(([column, value]) => column === "user_id" && value === accountId));
  }
  assert.equal(f.settings.user_id, accountId);
});

test("successful detection persists only installation fields and preserves customization", async () => {
  const f = fixture();
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.verified, true);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.mutations[0].table, "widget_settings");
  assert.equal(f.mutations[0].operation, "update");
  assert.deepEqual(Object.keys(f.mutations[0].values).sort(), ["is_installed", "updated_at"]);
  assert.equal(f.settings.is_installed, true);
  assert.ok(Number.isFinite(Date.parse(f.settings.updated_at)));
  for (const field of ["agent_name", "welcome_message", "primary_color"]) {
    assert.equal(f.settings[field], f.originalSettings[field]);
  }
});

test("creates missing widget settings for the authenticated account after successful detection", async () => {
  const f = fixture({ missingSettings: true });
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.verified, true);
  assert.equal(f.settings.user_id, accountId);
  assert.equal(f.settings.is_installed, true);
  assert.equal(f.mutations.length, 1);
  assert.equal(f.mutations[0].operation, "insert");
  assert.equal(f.settings.agent_name, "AI Support Assistant");
  assert.equal(f.settings.primary_color, "#2563eb");
  assert.equal(f.settings.welcome_message, "Hi! 👋 How can I help you today?");
});

test("requires the correct widget and authenticated public agent ID on the same active script", async (t) => {
  const cases = [
    "<html><body>No widget installed</body></html>",
    `<script src="${widgetOrigin}/widget.js" data-agent-id="${otherPublicAgentId}"></script>`,
    `<script src="${widgetOrigin}/widget.js"></script><div data-agent-id="${publicAgentId}"></div>`,
    `<!-- <script src="${widgetOrigin}/widget.js" data-agent-id="${publicAgentId}"></script> -->`,
    `<script src="https://unrelated.example/widget.js" data-agent-id="${publicAgentId}"></script>`,
  ];
  for (const [index, html] of cases.entries()) {
    await t.test(`false positive ${index + 1}`, async () => {
      const f = fixture({ html });
      const result = await f.request();
      assert.equal(result.body.verified, false);
      assert.equal(f.mutations.length, 0);
      assert.deepEqual(f.settings, f.originalSettings);
    });
  }
});

test("database failures never report verified or erase existing settings", async (t) => {
  for (const options of [{ agentError: true }, { agentMissing: true }, { updateError: true }, { missingSettings: true, updateError: true }, { missingSettings: true, insertError: true }]) {
    await t.test(JSON.stringify(options), async () => {
      const f = fixture(options);
      const result = await f.request();
      assert.ok(result.status >= 400);
      assert.notEqual(result.body.verified, true);
      assert.equal(f.mutations.length, 0);
    });
  }
});

test("enforces exact domain allowlist entries before fetching a page", async (t) => {
  for (const websiteUrl of ["https://www.customer.example", "https://sub.customer.example", "https://customer.example.evil.example"]) {
    await t.test(websiteUrl, async () => {
      const f = fixture({ agent: { allowed_domains: ["customer.example"] } });
      const result = await f.request({ websiteUrl });
      assert.equal(result.status, 403);
      assert.notEqual(result.body.verified, true);
      assert.equal(f.mutations.length, 0);
    });
  }
  const f = fixture({ agent: { allowed_domains: ["https://CUSTOMER.example./ignored-path"] } });
  assert.equal((await f.request()).body.verified, true);
});

test("passes the same exact allowlist policy to redirect validation", async () => {
  let checkedRedirect = false;
  const f = fixture({
    agent: { allowed_domains: ["customer.example"] },
    async fetchImpl(initialUrl, options) {
      assert.equal(options.isAllowed(initialUrl), true);
      assert.equal(options.isAllowed(new URL("https://customer.example/redirected")), true);
      assert.equal(options.isAllowed(new URL("https://www.customer.example/redirected")), false);
      checkedRedirect = true;
      throw new Error("Blocked redirected destination");
    },
  });
  const result = await f.request();
  assert.equal(checkedRedirect, true);
  assert.notEqual(result.body.verified, true);
  assert.ok(result.status >= 400);
  assert.equal(f.mutations.length, 0);
});

test("rejects invalid URLs and oversized JSON bodies without changing settings", async (t) => {
  for (const websiteUrl of ["javascript:alert(1)", "file:///etc/passwd", "https://user:password@customer.example"]) {
    await t.test(websiteUrl, async () => {
      const f = fixture();
      assert.equal((await f.request({ websiteUrl })).status, 400);
      assert.equal(f.fetches.length, 0);
      assert.equal(f.mutations.length, 0);
    });
  }
  const f = fixture();
  assert.equal((await f.request({ websiteUrl: customerUrl, extra: "x".repeat(5000) })).status, 413);
  assert.equal(f.mutations.length, 0);
});

test("unreachable websites preserve previously installed state", async () => {
  const f = fixture({ fetchError: new Error("Connection failed") });
  f.settings.is_installed = true;
  const result = await f.request();
  assert.ok(result.status >= 400);
  assert.notEqual(result.body.verified, true);
  assert.equal(f.settings.is_installed, true);
  assert.equal(f.mutations.length, 0);
});

test("preserves the browser loopback Host when NextRequest normalizes its URL", async () => {
  const browserOrigin = "http://127.0.0.1:3000";
  const f = fixture({
    env: { NODE_ENV: "development", AGENTDESK_APP_ORIGIN: "" },
    requestOrigin: "http://localhost:3000",
    headers: { host: "127.0.0.1:3000" },
    html: `<script src="${browserOrigin}/widget.js" data-agent-id="${publicAgentId}"></script>`,
  });
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.verified, true);
});

test("does not trust an external incoming Host to redefine the production widget", async () => {
  const f = fixture({
    requestOrigin: "https://localhost",
    headers: { host: "deployed-agent.example" },
    html: `<script src="https://deployed-agent.example/widget.js" data-agent-id="${publicAgentId}"></script>`,
  });
  assert.equal((await f.request()).body.verified, false);
});

test("invalid Host credentials and paths fall back to the request URL", async (t) => {
  for (const host of ["user:password@untrusted.example", "untrusted.example/path"]) {
    await t.test(host, async () => {
      const fallback = fixture({ headers: { host } });
      assert.equal((await fallback.request()).body.verified, true);
      const invalidHostScript = fixture({
        headers: { host },
        html: `<script src="https://untrusted.example/widget.js" data-agent-id="${publicAgentId}"></script>`,
      });
      const result = await invalidHostScript.request();
      assert.equal(result.status, 422);
      assert.equal(result.body.verified, false);
      assert.equal(invalidHostScript.mutations.length, 0);
    });
  }
});

test("a caller supplied Origin cannot redefine the expected widget source", async () => {
  const f = fixture({
    headers: { host: "agentdesk.example", origin: "https://untrusted.example" },
    html: `<script src="https://untrusted.example/widget.js" data-agent-id="${publicAgentId}"></script>`,
  });
  const result = await f.request();
  assert.equal(result.status, 422);
  assert.equal(result.body.verified, false);
  assert.equal(f.mutations.length, 0);
});
}

runTests().catch((error) => { console.error(error); process.exitCode = 1; });
