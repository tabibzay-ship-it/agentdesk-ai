/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const projectRoot = process.env.AGENTDESK_PROJECT_ROOT || path.resolve(__dirname, "..");
const projectRequire = Module.createRequire(path.join(projectRoot, "package.json"));
const ts = projectRequire("typescript");
const configSource = fs.readFileSync(path.resolve(__dirname, "../next.config.ts"), "utf8");

function loadConfig(mode, supabaseUrl = "https://project.supabase.co") {
  const previousMode = process.env.NODE_ENV;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    process.env.NODE_ENV = mode;
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
    const configModule = new Module(path.join(projectRoot, "next.config.ts"), module);
    configModule.filename = path.join(projectRoot, "next.config.ts");
    configModule.paths = Module._nodeModulePaths(projectRoot);
    configModule._compile(ts.transpileModule(configSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, configModule.filename);
    return configModule.exports.default;
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  }
}

async function headersFor(mode, url) {
  const rules = await loadConfig(mode, url).headers();
  return Object.fromEntries(rules.find((rule) => rule.source === "/(.*)").headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

test("production CSP restricts connection destinations and denies dangerous capabilities", async () => {
  const headers = await headersFor("production");
  const csp = Object.fromEntries(headers["content-security-policy"].split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
  assert.deepEqual(csp["connect-src"], ["'self'", "https://project.supabase.co", "wss://project.supabase.co"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'self'"]);
  assert.deepEqual(csp["form-action"], ["'self'"]);
  assert.equal(csp["script-src"].includes("'unsafe-eval'"), false);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["strict-transport-security"], "max-age=31536000");
  // The widget is loaded as a script on customer sites; do not opt those responses
  // into cross-origin isolation or a same-origin-only resource policy.
  assert.equal(headers["cross-origin-resource-policy"], undefined);
  assert.equal(headers["cross-origin-embedder-policy"], undefined);
});

test("development supports local Supabase and Next.js hot reload without sticky HSTS", async () => {
  const headers = await headersFor("development", "http://127.0.0.1:54321");
  assert.match(headers["content-security-policy"], /http:\/\/127\.0\.0\.1:54321 ws:\/\/127\.0\.0\.1:54321/);
  assert.match(headers["content-security-policy"], /'unsafe-eval'/);
  assert.equal(headers["strict-transport-security"], undefined);
});

test("invalid configuration cannot weaken CSP or send production auth over HTTP", () => {
  for (const url of [
    "http://project.supabase.co", "https://user:password@project.supabase.co",
    "https://project.supabase.co/path", "https://project.supabase.co?q=1",
    "https://project.supabase.co#part", "https://project.supabase.co;script-src",
    "data:text/plain,hello",
  ]) {
    assert.throws(() => loadConfig("production", url));
  }
});

test("API responses cannot be cached and production source maps remain disabled", async () => {
  const config = loadConfig("production");
  const rules = await config.headers();
  assert.equal(config.poweredByHeader, false);
  assert.equal(config.productionBrowserSourceMaps, false);
  assert.equal(rules.find((rule) => rule.source === "/api/:path*").headers.find((header) => header.key === "Cache-Control").value, "private, no-store, max-age=0");
});
