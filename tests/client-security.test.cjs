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
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
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

// Render the real client components into plain objects, with effects inert and
// hook state named from their AST so adding another state hook cannot shift a
// fixture's account, loading, or error state onto an unrelated field.
function pageFixture(relative, overrides = {}, extra = {}, auth = {}) {
  const filename = path.join(root, relative);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hookNames = [];
  function findHooks(node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
        node.initializer && ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(source) === "useState") {
      hookNames.push(node.name.elements[0].name.getText(source));
    }
    ts.forEachChild(node, findHooks);
  }
  findHooks(source);
  const states = new Map(Object.entries(overrides));
  const transitions = [];
  let hookIndex = 0;
  const react = {
    useState(initial) {
      const name = hookNames[hookIndex++];
      assert.ok(name, `Unexpected state hook in ${relative}`);
      if (!states.has(name)) states.set(name, typeof initial === "function" ? initial() : initial);
      return [states.get(name), (value) => states.set(name, typeof value === "function" ? value(states.get(name)) : value)];
    },
    useEffect() {},
    useRef(initial) { return { current: initial }; },
    useCallback(callback) { return callback; },
  };
  const jsx = (type, props) => ({ type, props });
  const supabase = { auth };
  const Page = load(relative, {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/navigation": { useRouter() {
      return {
        push(url) { transitions.push(["push", url]); },
        replace(url) { transitions.push(["replace", url]); },
      };
    } },
    "../../lib/supabase": { supabase },
    "@/lib/supabase": { supabase },
  }, { ...extra }).default;
  return {
    states, transitions,
    render() { hookIndex = 0; return Page(); },
  };
}

function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node !== "object") return String(node);
  return textContent(node.props?.children);
}

function findNode(tree, predicate) {
  if (Array.isArray(tree)) {
    for (const node of tree) {
      const found = findNode(node, predicate);
      if (found) return found;
    }
  } else if (tree && typeof tree === "object") {
    if (predicate(tree)) return tree;
    return findNode(tree.props?.children, predicate);
  }
  return undefined;
}

function button(tree, label) {
  const found = findNode(tree, (node) => node.type === "button" && textContent(node) === label);
  assert.ok(found, `Missing ${label} button`);
  return found;
}

function chatFixture(overrides = {}) {
  const ownerKey = "agentdesk-dashboard-test-visitor:owner-a:agent-a";
  const otherKey = "agentdesk-dashboard-test-visitor:owner-b:agent-b";
  const oldVisitor = "dashboard-test-33333333-3333-4333-8333-333333333333";
  const otherVisitor = "dashboard-test-55555555-5555-4555-8555-555555555555";
  const storage = new Map([[ownerKey, oldVisitor], [otherKey, otherVisitor]]);
  const requests = [];
  let uuidCounter = 0;
  const fixture = pageFixture("app/chat/page.tsx", {
    loading: false, sending: false, userId: "owner-a", publicAgentId: "agent-a",
    message: "Hello", messages: [], usage: null, error: "", ...overrides,
  }, {
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); },
      removeItem(key) { storage.delete(key); },
    },
    crypto: { randomUUID() { return `${String(++uuidCounter).padStart(8, "0")}-4444-4444-8444-444444444444`; } },
    async fetch(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, async json() { return { reply: "Test reply" }; } };
    },
  });
  return { ...fixture, storage, requests, ownerKey, otherKey, oldVisitor, otherVisitor };
}

test("Clear Chat rotates the scoped visitor for the next message and preserves another account", async () => {
  const fixture = chatFixture();
  let tree = fixture.render();
  const form = findNode(tree, (node) => node.type === "form");
  assert.ok(form, "Missing chat form");
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(fixture.requests[0].body.visitorId, fixture.oldVisitor);

  tree = fixture.render();
  button(tree, "Clear Chat").props.onClick();
  assert.equal(fixture.storage.has(fixture.ownerKey), false);
  assert.equal(fixture.storage.get(fixture.otherKey), fixture.otherVisitor);
  assert.equal(fixture.states.get("messages").length, 0);
  fixture.states.set("message", "New conversation");
  const nextForm = findNode(fixture.render(), (node) => node.type === "form");
  await nextForm.props.onSubmit({ preventDefault() {} });
  const newVisitor = fixture.requests[1].body.visitorId;
  assert.match(newVisitor, /^dashboard-test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(newVisitor, fixture.oldVisitor);
  assert.equal(fixture.storage.get(fixture.ownerKey), newVisitor);
  assert.equal(fixture.storage.get(fixture.otherKey), fixture.otherVisitor);
});

test("Clear Chat remains disabled and cannot rotate a conversation while its message is sending", () => {
  const message = { id: "pending", role: "user", content: "Pending message" };
  const fixture = chatFixture({ sending: true, messages: [message], error: "Existing feedback" });
  const clear = button(fixture.render(), "Clear Chat");
  assert.equal(clear.props.disabled, true);
  // Calling the handler directly verifies its guard, independently of the UI.
  clear.props.onClick();
  assert.equal(fixture.storage.get(fixture.ownerKey), fixture.oldVisitor);
  assert.equal(fixture.storage.get(fixture.otherKey), fixture.otherVisitor);
  assert.equal(fixture.states.get("messages")[0], message);
  assert.equal(fixture.states.get("error"), "Existing feedback");
});

test("both logout handlers preserve the page on returned or thrown failure and navigate only on success", async () => {
  for (const relative of ["app/settings/page.tsx", "app/dashboard/page.tsx"]) {
    for (const outcome of ["returned error", "thrown error", "success"]) {
      const calls = [];
      const fixture = pageFixture(relative, { loading: false }, {}, {
        async signOut(options) {
          calls.push(options);
          if (outcome === "thrown error") throw new Error("PRIVATE_DIAGNOSTIC");
          return { error: outcome === "returned error" ? { message: "PRIVATE_DIAGNOSTIC" } : null };
        },
      });
      await button(fixture.render(), "Sign Out").props.onClick();
      assert.equal(calls.length, 1, `${relative}: ${outcome}`);
      assert.equal(calls[0].scope, "global", `${relative}: preserves explicit global signout`);
      assert.equal(fixture.states.get("signingOut"), false, `${relative}: clears busy state`);
      if (outcome === "success") {
        assert.deepEqual(fixture.transitions, [["replace", "/login"]], relative);
        assert.equal(fixture.states.get("signOutError"), "", relative);
      } else {
        assert.deepEqual(fixture.transitions, [], `${relative}: ${outcome}`);
        assert.equal(fixture.states.get("signOutError"), "Could not sign out. Please try again.", relative);
        const visible = textContent(fixture.render());
        assert.ok(visible.includes("Could not sign out. Please try again."), relative);
        assert.equal(visible.includes("PRIVATE_DIAGNOSTIC"), false, relative);
      }
    }
  }
});
