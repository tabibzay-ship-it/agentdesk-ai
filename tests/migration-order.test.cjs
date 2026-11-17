/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const dependencyRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !dependencyRoot && "Temporary PostgreSQL test runtime is not configured";
const root = path.resolve(__dirname, "..");
const migration = (name) => fs.readFileSync(path.join(root, "supabase", "migrations", name), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";

test("a new database receives the base schema before dependent migrations", { skip }, async () => {
  const requireFromRuntime = createRequire(path.join(dependencyRoot, "package.json"));
  const { PGlite } = requireFromRuntime("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      insert into auth.users(id,email) values ('${owner}','synthetic@example.test');
    `);

    // PGlite provides gen_random_uuid() but does not package extension control
    // files. Real Supabase validates the unchanged CREATE EXTENSION statement;
    // only the in-process compatibility harness omits that one line.
    const baseMigration = migration("20261006000000_initial_application_schema.sql")
      .replace("create extension if not exists pgcrypto with schema extensions;", "");
    await db.exec(baseMigration);
    await db.exec(migration("20261007000000_add_agent_allowed_domains.sql"));
    await db.exec(migration("20261007010000_security_hardening.sql"));

    const relations = await db.query(`select to_regclass('public.agent_settings')::text as agent,
      to_regclass('public.business_profiles')::text as business,
      to_regclass('public.messages')::text as messages`);
    assert.deepEqual(relations.rows[0], {
      agent: "agent_settings",
      business: "business_profiles",
      messages: "messages",
    });
    const domains = await db.query(`select data_type from information_schema.columns
      where table_schema='public' and table_name='agent_settings' and column_name='allowed_domains'`);
    assert.equal(domains.rows[0].data_type, "ARRAY");
    const rls = await db.query(`select relrowsecurity, relforcerowsecurity from pg_class
      where oid='public.agent_settings'::regclass`);
    assert.equal(rls.rows[0].relrowsecurity, true);
    assert.equal(rls.rows[0].relforcerowsecurity, true);

    await db.exec(`insert into public.agent_settings(user_id, custom_instructions)
      values ('${owner}', 'preserve-me')`);
    await db.exec(baseMigration);
    const preserved = await db.query("select custom_instructions from public.agent_settings where user_id=$1", [owner]);
    assert.equal(preserved.rows[0].custom_instructions, "preserve-me");
  } finally {
    await db.close();
  }
});
