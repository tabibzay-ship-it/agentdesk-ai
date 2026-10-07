/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const dependencies = createRequire(path.join(process.env.AGENTDESK_PROJECT_ROOT || root, "package.json"));
const ts = dependencies("typescript");

function load(relative, imports = {}, extra = {}) {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, {
    module: compiled, exports: compiled.exports, atob, URL,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
    ...extra,
  }, { filename });
  return compiled.exports;
}

const helpers = load("lib/client-security.ts");
const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;

test("browser credentials reject service-role, secret, malformed and missing keys", () => {
  assert.equal(helpers.isPublishableSupabaseKey("sb_publishable_test-key"), true);
  assert.equal(helpers.isPublishableSupabaseKey(jwt("anon")), true);
  for (const key of [jwt("service_role"), jwt("authenticated"), "sb_secret_private", "", "broken.jwt.payload"]) {
    assert.equal(helpers.isPublishableSupabaseKey(key), false);
  }
  let created = false;
  assert.throws(() => load("lib/supabase.ts", {
    "@supabase/supabase-js": { createClient() { created = true; } },
    "./client-security": helpers,
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") } } }), /must be a publishable or anon key/);
  assert.equal(created, false);
});

test("logout and account changes discard private page state without exposing session data", () => {
  let callback;
  const transitions = [];
  const window = { location: {
    pathname: "/conversations", replace(value) { transitions.push(["replace", value]); },
    reload() { transitions.push(["reload"]); },
  } };
  load("lib/supabase.ts", {
    "@supabase/supabase-js": { createClient() { return { auth: { onAuthStateChange(fn) { callback = fn; } } }; } },
    "./client-security": helpers,
  }, { window, process: { env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test-key",
  } } });
  callback("INITIAL_SESSION", { user: { id: "first-owner" } });
  callback("TOKEN_REFRESHED", { user: { id: "first-owner" } });
  assert.deepEqual(transitions, []);
  callback("SIGNED_IN", { user: { id: "second-owner" } });
  callback("SIGNED_OUT", null);
  assert.deepEqual(transitions, [["reload"], ["replace", "/login"]]);
  window.location.pathname = "/register";
  callback("SIGNED_OUT", null);
  assert.equal(transitions.length, 2);
});

test("untrusted form values have bounds and website protocols cannot become executable links", () => {
  assert.equal(helpers.isBoundedText("hello", 5), true);
  assert.equal(helpers.isBoundedText("hello!", 5), false);
  assert.equal(helpers.isBoundedText("x\0", 5), false);
  assert.equal(helpers.isHttpWebsite("https://company.example/support"), true);
  assert.equal(helpers.isHttpWebsite(""), true);
  for (const url of ["javascript:alert(1)", "data:text/html,test", "https://user:password@company.example", "file:///etc/passwd"]) {
    assert.equal(helpers.isHttpWebsite(url), false);
  }
  for (const email of ["person@example.com", "person+test@example.com"]) assert.equal(helpers.isValidEmail(email), true);
  for (const email of ["a@example.com\n", "invalid", `${"a".repeat(255)}@example.com`]) assert.equal(helpers.isValidEmail(email), false);
});
