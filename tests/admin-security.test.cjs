/* eslint-disable @typescript-eslint/no-require-imports -- isolated CommonJS security harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261011000000_super_admin.sql"), "utf8");

function compile(file) {
  const compiledModule = { exports: {} };
  const context = { module: compiledModule, exports: compiledModule.exports, Request, Response, Headers, URL, crypto, console, process: { env: {} },
    require(name) {
      if (name === "server-only") return {};
      if (name === "@supabase/supabase-js") return { createClient() { throw new Error("not configured"); } };
      if (name === "next/server") return { NextResponse: { json: (data, init) => Response.json(data, init) } };
      return require(name);
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, context, { filename: file });
  return compiledModule.exports;
}

function adminFixture({ role = true, factor = true, aal = "aal2", authError = false, roleError = false } = {}) {
  const user = { id: "11111111-1111-4111-8111-111111111111", factors: factor ? [{ factor_type: "totp", status: "verified" }] : [] };
  return {
    auth: {
      async getUser() { return authError ? { data: { user: null }, error: {} } : { data: { user }, error: null }; },
      async getClaims() { return authError ? { data: null, error: {} } : { data: { claims: { sub: user.id, aal } }, error: null }; },
    },
    from(table) {
      assert.equal(table, "super_admins");
      return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: role ? { user_id: user.id, is_active: true, mfa_required: true } : null, error: roleError ? {} : null }; } };
    },
  };
}

const server = compile("lib/admin-server.ts");

test("admin migration keeps role and audit tables inaccessible to browser roles", () => {
  assert.match(migration, /alter table public\.super_admins enable row level security/i);
  assert.match(migration, /alter table public\.super_admins force row level security/i);
  assert.match(migration, /alter table public\.admin_audit_events force row level security/i);
  assert.match(migration, /revoke all on table public\.super_admins, public\.admin_audit_events from public, anon, authenticated/i);
  assert.match(migration, /grant select on table public\.super_admins to service_role/i);
  assert.match(migration, /grant select, insert on table public\.admin_audit_events to service_role/i);
  assert.doesNotMatch(migration, /grant all on table public\.super_admins/i);
  assert.doesNotMatch(migration, /create policy/i);
});

test("first administrator provisioning is verified, serialized, one-time and unavailable to service/browser roles", () => {
  assert.match(migration, /email_confirmed_at is not null/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /if exists \(select 1 from public\.super_admins where is_active is true\)/i);
  assert.match(migration, /insert into public\.admin_audit_events[\s\S]*admin\.provisioned/i);
  assert.match(migration, /revoke all on function public\.admin_provision_first_super_admin\(uuid, text\) from public, anon, authenticated, service_role/i);
});

test("admin authentication rejects missing, invalid and ordinary-user sessions", async () => {
  assert.equal((await server.authenticateAdminRequest(new Request("https://example.com/api/admin"), adminFixture())).response.status, 401);
  assert.equal((await server.authenticateAdminRequest(new Request("https://example.com/api/admin", { headers: { authorization: "Bearer x" } }), adminFixture({ authError: true }))).response.status, 401);
  assert.equal((await server.authenticateAdminRequest(new Request("https://example.com/api/admin", { headers: { authorization: "Bearer x" } }), adminFixture({ role: false }))).response.status, 403);
});

test("admin authentication requires verified TOTP and an AAL2 session", async () => {
  const request = new Request("https://example.com/api/admin", { headers: { authorization: "Bearer x" } });
  const noFactor = await server.authenticateAdminRequest(request, adminFixture({ factor: false }));
  assert.equal(noFactor.response.status, 403);
  assert.equal((await noFactor.response.json()).code, "MFA_SETUP_REQUIRED");
  const aal1 = await server.authenticateAdminRequest(request, adminFixture({ aal: "aal1" }));
  assert.equal(aal1.response.status, 403);
  assert.equal((await aal1.response.json()).code, "MFA_REQUIRED");
  const allowed = await server.authenticateAdminRequest(request, adminFixture());
  assert.equal(allowed.user.id, "11111111-1111-4111-8111-111111111111");
});

test("admin API exposes no public signup, secures audited settings mutation and hides conversation contents", () => {
  const route = fs.readFileSync(path.join(root, "app/api/admin/route.ts"), "utf8");
  assert.doesNotMatch(route, /export async function (POST|PUT|DELETE)/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /origin !== new URL\(request\.url\)\.origin/);
  assert.match(route, /authenticateAdminRequest\(request\)/);
  assert.match(route, /admin_update_ai_credit_controls/);
  assert.match(route, /admin\.ai_credit_controls\.update/);
  assert.match(route, /conversations[\s\S]*select\("id,user_id,created_at"\)/);
  assert.doesNotMatch(route, /messages"\)\.select\("[^\"]*content/);
  assert.match(route, /paymentsEnabled: false/);
});
