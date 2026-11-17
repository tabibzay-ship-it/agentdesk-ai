/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL-compatible test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const runtimeRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !runtimeRoot && "Temporary PostgreSQL test runtime is not configured";
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261011000000_super_admin.sql"), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function database() {
  const dependencies = createRequire(path.join(runtimeRoot, "package.json"));
  const { PGlite } = dependencies("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
    insert into auth.users values ('${owner}', now()),('${other}', now());
  `);
  await db.exec(migration);
  return db;
}

test("admin migration provisions exactly one verified administrator and audits it", { skip }, async () => {
  const db = await database();
  try {
    await db.query("select public.admin_provision_first_super_admin($1,$2)", [owner, "Initial owner-controlled provisioning"]);
    assert.deepEqual((await db.query("select user_id,is_active,mfa_required,role from public.super_admins")).rows[0], { user_id: owner, is_active: true, mfa_required: true, role: "super_admin" });
    assert.equal((await db.query("select action,outcome from public.admin_audit_events")).rows[0].action, "admin.provisioned");
    await assert.rejects(db.query("select public.admin_provision_first_super_admin($1,$2)", [other, "Unauthorized second administrator"]));
    assert.equal((await db.query("select count(*)::int as count from public.super_admins")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("authenticated users cannot read, write or invoke administrator objects", { skip }, async () => {
  const db = await database();
  try {
    await db.query("select public.admin_provision_first_super_admin($1,$2)", [owner, "Initial owner-controlled provisioning"]);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.super_admins"));
    await assert.rejects(db.query("select * from public.admin_audit_events"));
    await assert.rejects(db.query("insert into public.super_admins(user_id,provision_reason) values($1,$2)", [other, "Privilege escalation attempt"]));
    await assert.rejects(db.query("select public.admin_provision_first_super_admin($1,$2)", [other, "Privilege escalation attempt"]));
  } finally { await db.exec("reset role"); await db.close(); }
});

test("service role can append audit events but cannot provision administrators", { skip }, async () => {
  const db = await database();
  try {
    await db.exec("set role service_role");
    await db.query("insert into public.admin_audit_events(admin_user_id,action,outcome) values($1,'admin.settings.read','allowed')", [owner]);
    assert.equal((await db.query("select count(*)::int as count from public.admin_audit_events")).rows[0].count, 1);
    await assert.rejects(db.query("delete from public.admin_audit_events"));
    await assert.rejects(db.query("insert into public.super_admins(user_id,provision_reason) values($1,$2)", [owner, "Service role escalation attempt"]));
    await assert.rejects(db.query("select public.admin_provision_first_super_admin($1,$2)", [owner, "Service role escalation attempt"]));
  } finally { await db.exec("reset role"); await db.close(); }
});
