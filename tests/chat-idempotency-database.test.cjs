/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL-compatible test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const runtimeRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !runtimeRoot && "Temporary PostgreSQL test runtime is not configured";
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261016000000_chat_request_idempotency.sql"), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);

async function database() {
  const dependencies = createRequire(path.join(runtimeRoot, "package.json"));
  const { PGlite } = dependencies("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
  `);
  return db;
}

test("idempotency migration executes twice and remains server-only", { skip }, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    await db.exec(migration);
    const table = (await db.query("select relrowsecurity, relforcerowsecurity from pg_class where oid='public.chat_request_keys'::regclass")).rows[0];
    assert.deepEqual(table, { relrowsecurity: true, relforcerowsecurity: true });
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.chat_request_keys"));
  } finally { await db.close(); }
});

test("concurrent duplicate claims create exactly one durable request key", { skip }, async () => {
  const db = await database();
  try {
    await db.exec(migration);
    const statement = "insert into public.chat_request_keys(id,user_id,visitor_id,request_hash) values ($1,$2,$3,$4)";
    const results = await Promise.allSettled([
      db.query(statement, [requestId, owner, "dashboard-test-11111111-1111-4111-8111-111111111111", hash]),
      db.query(statement, [requestId, owner, "dashboard-test-11111111-1111-4111-8111-111111111111", hash]),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
    assert.equal((await db.query("select count(*)::int as count from public.chat_request_keys")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("a later transaction failure rolls the idempotency migration back", { skip }, async () => {
  const db = await database();
  try {
    const body = migration.replace(/^begin;\s*/i, "").replace(/\s*commit;\s*$/i, "");
    await assert.rejects(db.exec(`begin; ${body} select 1 / 0; commit;`));
    await db.exec("rollback");
    assert.equal((await db.query("select to_regclass('public.chat_request_keys') as relation")).rows[0].relation, null);
  } finally { await db.close(); }
});
