/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL-compatible test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const runtimeRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !runtimeRoot && "Temporary PostgreSQL test runtime is not configured";
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261013000000_marketing_consent.sql"), "utf8");

async function database() {
  const dependencies = createRequire(path.join(runtimeRoot, "package.json"));
  const { PGlite } = dependencies("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(
      id uuid primary key,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
  `);
  await db.exec(migration);
  return db;
}

test("registration consent is captured once and browser roles cannot read it", { skip }, async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users(id,raw_user_meta_data) values
      ('11111111-1111-4111-8111-111111111111','{"marketing_consent":true,"marketing_consent_policy":"2026-10"}'),
      ('22222222-2222-4222-8222-222222222222','{"marketing_consent":false}');`);
    const preferences = await db.query("select user_id::text,consented,consented_at is not null as has_date from public.marketing_preferences order by user_id");
    assert.deepEqual(preferences.rows.map((row) => [row.consented, row.has_date]), [[true, true], [false, false]]);
    const events = await db.query("select count(*)::int as count from public.marketing_consent_events");
    assert.equal(events.rows[0].count, 2);
    await assert.rejects(db.exec("set role authenticated; select * from public.marketing_preferences"), /permission denied/i);
    await db.exec("reset role; set role service_role; select public.set_marketing_consent('11111111-1111-4111-8111-111111111111',false,'2026-10'); reset role;");
    const withdrawn = await db.query("select consented,withdrawn_at is not null as withdrawn from public.marketing_preferences where user_id='11111111-1111-4111-8111-111111111111'");
    assert.deepEqual(withdrawn.rows[0], { consented: false, withdrawn: true });
    const updatedEvents = await db.query("select count(*)::int as count from public.marketing_consent_events");
    assert.equal(updatedEvents.rows[0].count, 3);
  } finally { await db.close(); }
});

test("marketing consent migration can be rerun without changing recorded choices", { skip }, async () => {
  const db = await database();
  try {
    await db.exec("insert into auth.users(id,raw_user_meta_data) values ('33333333-3333-4333-8333-333333333333','{\"marketing_consent\":true}')");
    const before = await db.query("select consented,policy_version,source,consented_at from public.marketing_preferences");
    await db.exec(migration);
    const after = await db.query("select consented,policy_version,source,consented_at from public.marketing_preferences");
    assert.deepEqual(after.rows, before.rows);
  } finally { await db.close(); }
});
