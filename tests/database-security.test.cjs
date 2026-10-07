/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createRequire } = require("node:module");

// Run with AGENTDESK_PGLITE_ROOT pointing to a temporary test dependency folder.
// PGlite is deliberately not a production application dependency. These tests
// use a synthetic database only and never read .env.local or a live account.
const testDependencyRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !testDependencyRoot && "Temporary PostgreSQL test runtime is not configured";
const projectRoot = process.env.AGENTDESK_PROJECT_ROOT || path.resolve(__dirname, "..");
const migrationPath = process.env.AGENTDESK_MIGRATION_PATH || path.join(projectRoot, "supabase/migrations/20261007010000_security_hardening.sql");
const migration = () => fs.readFileSync(migrationPath, "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function database(reserveAsJson = false, options = {}) {
  const { rateRpc = "plain", release = "date", periodType = "date", migrate = true } = options;
  assert.ok(["plain", "defaults", "missing"].includes(rateRpc));
  assert.ok(["date", "timestamp", "both", "missing"].includes(release));
  assert.ok(["date", "timestamptz"].includes(periodType));
  const dependencies = createRequire(path.join(testDependencyRoot, "package.json"));
  const { PGlite } = dependencies("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table public.business_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, business_name text, description text, email text, phone text, website text, address text);
    create table public.knowledge_sources(id uuid primary key default gen_random_uuid(), user_id uuid, title text, content text);
    create table public.agent_settings(id uuid primary key default gen_random_uuid(), user_id uuid unique, public_agent_id uuid unique default gen_random_uuid(), is_active boolean default true, tone text default 'professional', custom_instructions text, allowed_domains text[] not null default '{}', updated_at timestamptz);
    create table public.widget_settings(id uuid primary key default gen_random_uuid(), user_id uuid unique, agent_name text default 'Support', welcome_message text, primary_color text default '#123456', is_installed boolean default false, updated_at timestamptz);
    create table public.conversations(id uuid primary key default gen_random_uuid(), user_id uuid);
    create table public.messages(id uuid primary key default gen_random_uuid(), conversation_id uuid references public.conversations(id), role text, content text);
    create table public.usage_limits(user_id uuid primary key, plan text default 'free', monthly_limit integer default 3, messages_used integer default 0, period_start ${periodType} default date_trunc('month', current_date)::${periodType});
    insert into public.usage_limits(user_id) values ('${owner}'), ('${other}');
    create view public.legacy_leaking_view as select * from public.usage_limits;
    grant all on all tables in schema public to anon, authenticated, service_role;
    grant update(public_agent_id) on public.agent_settings to anon, authenticated;
    grant update(is_installed) on public.widget_settings to anon, authenticated;
    create policy old_public_policy on public.business_profiles for all to public using (true) with check (true);
  `);
  if (rateRpc !== "missing") {
    await db.exec(`create function public.check_chat_rate_limit(p_agent_id uuid,p_visitor_id text,p_limit integer${rateRpc === "defaults" ? " default 10" : ""},p_window_seconds integer${rateRpc === "defaults" ? " default 60" : ""})
      returns boolean language sql as $$select true$$;`);
  }
  if (release === "timestamp" || release === "both") {
    await db.exec(`create function public.release_ai_usage(p_user_id uuid,p_period_start timestamptz)
      returns void language sql as $$update public.usage_limits set messages_used = greatest(0, messages_used - 1) where user_id = p_user_id and period_start = p_period_start$$;`);
  }
  if (release === "date") {
    await db.exec(`create function public.release_ai_usage(p_user_id uuid,p_period_start date)
      returns void language sql as $$update public.usage_limits set messages_used = greatest(0, messages_used - 1) where user_id = p_user_id and period_start = p_period_start$$;`);
  } else if (release === "both") {
    // Reproduce the prior compatibility wrapper: midnight uses the caller's
    // timezone and discards a timestamp's precise period token.
    await db.exec(`create function public.release_ai_usage(p_user_id uuid,p_period_start date)
      returns void language sql as $$select public.release_ai_usage(p_user_id,p_period_start::timestamptz)$$;`);
  }
  const reserveBody = `declare v_row public.usage_limits; begin
    select * into strict v_row from public.usage_limits where user_id=p_user_id;
    if v_row.messages_used < v_row.monthly_limit then
      update public.usage_limits set messages_used=messages_used+1 where user_id=p_user_id returning * into v_row;
      return jsonb_build_object('allowed',true,'plan',v_row.plan,'used',v_row.messages_used,'monthly_limit',v_row.monthly_limit,'remaining',v_row.monthly_limit-v_row.messages_used,'period_start',v_row.period_start);
    end if;
    return jsonb_build_object('allowed',false,'plan',v_row.plan,'used',v_row.messages_used,'monthly_limit',v_row.monthly_limit,'remaining',0,'period_start',v_row.period_start);
  end`;
  if (reserveAsJson) {
    await db.exec(`create function public.reserve_ai_usage(p_user_id uuid) returns jsonb language plpgsql as $$${reserveBody}$$;`);
  } else {
    await db.exec(`create function public.mock_reserve(p_user_id uuid) returns jsonb language plpgsql as $$${reserveBody}$$;
      create function public.reserve_ai_usage(p_user_id uuid)
      returns table(allowed boolean,plan text,used integer,monthly_limit integer,remaining integer,period_start ${periodType})
      language sql as $$select * from jsonb_to_record(public.mock_reserve(p_user_id)) as r(allowed boolean,plan text,used integer,monthly_limit integer,remaining integer,period_start ${periodType})$$;`);
  }
  if (migrate) await db.exec(migration());
  return db;
}

for (const reserveAsJson of [false, true]) {
  test(`usage wrapper preserves ${reserveAsJson ? "JSON" : "TABLE"} results and refunds exactly once`, { skip }, async () => {
    const db = await database(reserveAsJson);
    try {
      const result = await db.query("select public.security_reserve_ai_usage($1) as usage", [owner]);
      const usage = result.rows[0].usage;
      assert.equal(usage.allowed, true);
      assert.equal(usage.used, 1);
      assert.match(usage.reservation_id, /^[a-f\d-]{36}$/i);
      assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [other, usage.reservation_id])).rows[0].refunded, false);
      assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, true);
      assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, false);
      assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);
      const permitted = await Promise.all(Array.from({ length: 6 }, () => db.query("select public.security_reserve_ai_usage($1) as usage", [owner])));
      assert.equal(permitted.filter((row) => row.rows[0].usage.allowed).length, 3);
      const allowedUsage = permitted.find((row) => row.rows[0].usage.allowed).rows[0].usage;
      await db.query("update public.usage_limits set period_start=period_start+interval '1 month',messages_used=2 where user_id=$1", [owner]);
      await db.query("select public.security_release_ai_usage($1,$2)", [owner, allowedUsage.reservation_id]);
      assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 2);
    } finally { await db.close(); }
  });
}

test("RLS and grants isolate accounts and prevent billing, public-ID, installation, view and RPC bypasses", { skip }, async () => {
  const db = await database();
  try {
    await db.exec(`insert into public.business_profiles(user_id,business_name) values ('${owner}','Owner'),('${other}','Other');
      insert into public.agent_settings(user_id) values ('${owner}');
      insert into public.widget_settings(user_id) values ('${owner}');
      insert into public.conversations(user_id) values ('${owner}'),('${other}');
      insert into public.messages(conversation_id,role,content) select id,'assistant','private' from public.conversations;
      set role authenticated; set request.jwt.claim.sub = '${owner}';`);
    assert.equal((await db.query("select count(*)::int as count from public.business_profiles")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from public.messages")).rows[0].count, 1);
    assert.equal((await db.query("update public.business_profiles set description='changed' where user_id=$1 returning user_id", [other])).rows.length, 0);
    await assert.rejects(db.query("insert into public.knowledge_sources(user_id,title,content) values($1,'test','test')", [other]));
    await assert.rejects(db.query("update public.business_profiles set user_id=$1 where user_id=$2", [other, owner]));
    await assert.rejects(db.query("update public.agent_settings set public_agent_id=gen_random_uuid()"));
    await assert.rejects(db.query("update public.widget_settings set is_installed=true"));
    await assert.rejects(db.query("update public.usage_limits set monthly_limit=999999"));
    await assert.rejects(db.query("select * from public.legacy_leaking_view"));
    await assert.rejects(db.query("select public.reserve_ai_usage($1)", [owner]));
    await assert.rejects(db.query("select public.security_reserve_ai_usage($1)", [owner]));
    await assert.rejects(db.query("insert into public.knowledge_sources(user_id,title,content) values($1,'test',$2)", [owner, "x".repeat(200001)]));
    await db.exec(`reset role; set role anon;`);
    await assert.rejects(db.query("select * from public.business_profiles"));
    await assert.rejects(db.query("select public.check_chat_rate_limit($1,'visitor',10,60)", [owner]));
  } finally { await db.close(); }
});

test("rate buckets enforce count limits, isolate owners, expire and reject invalid parameters", { skip }, async () => {
  const db = await database();
  try {
    const checks = await Promise.all(Array.from({ length: 20 }, () => db.query("select public.check_chat_rate_limit($1,'visitor',10,60) as allowed", [owner])));
    assert.equal(checks.filter((row) => row.rows[0].allowed).length, 10);
    assert.equal((await db.query("select public.check_chat_rate_limit($1,'visitor',10,60) as allowed", [other])).rows[0].allowed, true);
    await db.exec("update agentdesk_private.chat_rate_buckets set window_started=now()-interval '61 seconds'");
    assert.equal((await db.query("select public.check_chat_rate_limit($1,'visitor',10,60) as allowed", [owner])).rows[0].allowed, true);
    await assert.rejects(db.query("select public.check_chat_rate_limit($1,'visitor',0,60)", [owner]));
    await assert.rejects(db.query("select public.check_chat_rate_limit($1,'visitor',10,3601)", [owner]));
  } finally { await db.close(); }
});

const compatibilityFixtures = [
  { reserveAsJson: false, release: "timestamp", periodType: "timestamptz", rateRpc: "missing" },
  { reserveAsJson: true, release: "timestamp", periodType: "timestamptz", rateRpc: "defaults" },
  { reserveAsJson: false, release: "both", periodType: "timestamptz", rateRpc: "defaults" },
  { reserveAsJson: true, release: "both", periodType: "timestamptz", rateRpc: "missing" },
  { reserveAsJson: false, release: "date", periodType: "date", rateRpc: "defaults" },
  { reserveAsJson: true, release: "date", periodType: "date", rateRpc: "missing" },
];

for (const fixture of compatibilityFixtures) {
  test(`migration supports ${fixture.reserveAsJson ? "JSON" : "TABLE"} reserve, ${fixture.release} release and ${fixture.rateRpc} rate RPC`, { skip }, async () => {
    const db = await database(fixture.reserveAsJson, fixture);
    try {
      const usage = (await db.query("select public.security_reserve_ai_usage($1) as usage", [owner])).rows[0].usage;
      assert.equal(usage.allowed, true);
      assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, true);
      assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);

      const defaults = (await db.query("select pronargdefaults from pg_proc where oid='public.check_chat_rate_limit(uuid,text,integer,integer)'::regprocedure")).rows[0].pronargdefaults;
      assert.equal(defaults, fixture.rateRpc === "defaults" ? 2 : 0);
      const rateSql = fixture.rateRpc === "defaults"
        ? "select public.check_chat_rate_limit($1,'compatibility-visitor') as allowed"
        : "select public.check_chat_rate_limit($1,'compatibility-visitor',10,60) as allowed";
      const rate = [];
      for (let index = 0; index < 11; index++) rate.push((await db.query(rateSql, [owner])).rows[0].allowed);
      assert.deepEqual(rate, Array(10).fill(true).concat(false));
      const access = await db.query(`select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
        has_function_privilege('anon',p.oid,'execute') as anon_execute,
        has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
        has_function_privilege('service_role',p.oid,'execute') as service_execute
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('reserve_ai_usage','release_ai_usage','security_reserve_ai_usage','security_release_ai_usage','check_chat_rate_limit')`);
      assert.ok(access.rows.length >= 5);
      for (const row of access.rows) {
        assert.equal(row.anon_execute, false, `${row.proname}: anon`);
        assert.equal(row.authenticated_execute, false, `${row.proname}: authenticated`);
        assert.equal(row.service_execute, true, `${row.proname}: service_role`);
      }
    } finally { await db.close(); }
  });
}

for (const reserveAsJson of [false, true]) {
  test(`timestamp refunds preserve exact period tokens, timezone changes and month rollover (${reserveAsJson ? "JSON" : "TABLE"})`, { skip }, async () => {
    const db = await database(reserveAsJson, { release: "both", periodType: "timestamptz", rateRpc: "missing" });
    try {
      for (const timestamp of [
        "2026-10-01T00:00:00Z",
        "2026-10-01T00:00:00+04:30",
        "2026-10-31T23:59:59.123456Z",
        "2026-12-01T00:00:00+05:45",
      ]) {
        await db.query("update public.usage_limits set period_start=$2::timestamptz,messages_used=0 where user_id=$1", [owner, timestamp]);
        await db.exec("set timezone='Pacific/Kiritimati'");
        const usage = (await db.query("select public.security_reserve_ai_usage($1) as usage", [owner])).rows[0].usage;
        assert.equal(usage.allowed, true);
        const reservationRow = (await db.query(`select period_start_at=$2::timestamptz as exact_timestamp,
          period_start=(($2::timestamptz at time zone 'UTC')::date) as utc_date
          from agentdesk_private.ai_usage_reservations where id=$1`, [usage.reservation_id, timestamp])).rows[0];
        assert.deepEqual(reservationRow, { exact_timestamp: true, utc_date: true });
        await db.exec("set timezone='America/Los_Angeles'");
        assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, true);
        assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);
        assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, false);
      }

      await db.exec("set timezone='UTC'");
      await db.query("update public.usage_limits set period_start='2026-10-01T00:00:00Z',messages_used=0 where user_id=$1", [owner]);
      const oldUsage = (await db.query("select public.security_reserve_ai_usage($1) as usage", [owner])).rows[0].usage;
      await db.query("update public.usage_limits set period_start='2026-11-01T00:00:00Z',messages_used=2 where user_id=$1", [owner]);
      await db.exec("set timezone='Asia/Kabul'");
      assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, oldUsage.reservation_id])).rows[0].refunded, true);
      assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 2);

      // The retained date overload has a defined UTC-month meaning for legacy
      // callers, independent of the session's offset.
      for (const timezone of ["Asia/Kabul", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        await db.query("update public.usage_limits set period_start='2026-11-01T00:00:00Z',messages_used=1 where user_id=$1", [owner]);
        await db.query("select set_config('TimeZone',$1,false)", [timezone]);
        await db.query("select public.release_ai_usage($1,'2026-11-01'::date)", [owner]);
        assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0, timezone);
      }
    } finally { await db.close(); }
  });
}

test("date accounting remains date-based across timezone changes", { skip }, async () => {
  const db = await database(true, { release: "date", periodType: "date", rateRpc: "missing" });
  try {
    await db.query("update public.usage_limits set period_start='2026-10-01',messages_used=0 where user_id=$1", [owner]);
    await db.exec("set timezone='Pacific/Kiritimati'");
    const usage = (await db.query("select public.security_reserve_ai_usage($1) as usage", [owner])).rows[0].usage;
    const reservationRow = (await db.query("select period_start_at is null as no_timestamp,period_start='2026-10-01'::date as correct_date from agentdesk_private.ai_usage_reservations where id=$1", [usage.reservation_id])).rows[0];
    assert.deepEqual(reservationRow, { no_timestamp: true, correct_date: true });
    await db.exec("set timezone='America/Los_Angeles'");
    assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, true);
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);
  } finally { await db.close(); }
});

test("a failed underlying refund rolls back release marking and allows a safe retry", { skip }, async () => {
  const db = await database(true, { release: "timestamp", periodType: "timestamptz", rateRpc: "missing" });
  try {
    const usage = (await db.query("select public.security_reserve_ai_usage($1) as usage", [owner])).rows[0].usage;
    await db.exec(`create or replace function public.release_ai_usage(p_user_id uuid,p_period_start timestamptz)
      returns void language plpgsql set search_path='' as $$begin
        update public.usage_limits set messages_used=greatest(0,messages_used-1) where user_id=p_user_id and period_start=p_period_start;
        raise exception 'Synthetic refund failure';
      end$$;`);
    await assert.rejects(db.query("select public.security_release_ai_usage($1,$2)", [owner, usage.reservation_id]), /Synthetic refund failure/);
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 1);
    assert.equal((await db.query("select released_at is null as unrefunded from agentdesk_private.ai_usage_reservations where id=$1", [usage.reservation_id])).rows[0].unrefunded, true);
    await db.exec(`create or replace function public.release_ai_usage(p_user_id uuid,p_period_start timestamptz)
      returns void language sql set search_path='' as $$update public.usage_limits set messages_used=greatest(0,messages_used-1) where user_id=p_user_id and period_start=p_period_start$$;`);
    assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, true);
    assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, false);
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);
  } finally { await db.close(); }
});

test("failed reservation validation rolls back the native counter increment", { skip }, async () => {
  const db = await database(true, { release: "timestamp", periodType: "timestamptz", rateRpc: "missing" });
  try {
    await db.exec(`create or replace function public.reserve_ai_usage(p_user_id uuid)
      returns jsonb language plpgsql set search_path='' as $$begin
        update public.usage_limits set messages_used=messages_used+1 where user_id=p_user_id;
        return jsonb_build_object('allowed',true,'period_start',null);
      end$$;`);
    await assert.rejects(db.query("select public.security_reserve_ai_usage($1)", [owner]));
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);
    assert.equal((await db.query("select count(*)::int as count from agentdesk_private.ai_usage_reservations")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("migration reruns preserve data, reservations, limits and existing optional rate arguments", { skip }, async () => {
  const db = await database(false, { release: "both", periodType: "timestamptz", rateRpc: "defaults" });
  try {
    const usage = (await db.query("select public.security_reserve_ai_usage($1) as usage", [owner])).rows[0].usage;
    await db.query("select public.check_chat_rate_limit($1,'persistent',2,60)", [owner]);
    await db.query("insert into public.business_profiles(user_id,business_name) values($1,'Existing production data')", [owner]);
    const before = await db.query("select period_start_at::text as exact_token,period_start::text as day,released_at from agentdesk_private.ai_usage_reservations where id=$1", [usage.reservation_id]);
    await db.exec(migration());
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 1);
    assert.equal((await db.query("select business_name from public.business_profiles where user_id=$1", [owner])).rows[0].business_name, "Existing production data");
    assert.deepEqual((await db.query("select period_start_at::text as exact_token,period_start::text as day,released_at from agentdesk_private.ai_usage_reservations where id=$1", [usage.reservation_id])).rows, before.rows);
    assert.equal((await db.query("select public.check_chat_rate_limit($1,'persistent',2,60) as allowed", [owner])).rows[0].allowed, true);
    assert.equal((await db.query("select public.check_chat_rate_limit($1,'persistent',2,60) as allowed", [owner])).rows[0].allowed, false);
    assert.equal((await db.query("select pronargdefaults from pg_proc where oid='public.check_chat_rate_limit(uuid,text,integer,integer)'::regprocedure")).rows[0].pronargdefaults, 2);
    assert.equal((await db.query("select public.security_release_ai_usage($1,$2) as refunded", [owner, usage.reservation_id])).rows[0].refunded, true);
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 0);
  } finally { await db.close(); }
});

test("missing native accounting prerequisites abort the transaction without changing data or grants", { skip }, async () => {
  const db = await database(false, { release: "missing", periodType: "timestamptz", rateRpc: "missing", migrate: false });
  try {
    await db.query("update public.usage_limits set messages_used=2 where user_id=$1", [owner]);
    await assert.rejects(db.exec(migration()));
    await db.exec("rollback");
    assert.equal((await db.query("select messages_used from public.usage_limits where user_id=$1", [owner])).rows[0].messages_used, 2);
    assert.equal((await db.query("select has_table_privilege('anon','public.usage_limits','update') as prior_grant")).rows[0].prior_grant, true);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.usage_limits'::regclass")).rows[0].relrowsecurity, false);
    assert.equal((await db.query("select to_regnamespace('agentdesk_private') is null as no_private_schema")).rows[0].no_private_schema, true);
    assert.equal((await db.query("select to_regprocedure('public.check_chat_rate_limit(uuid,text,integer,integer)') is null as still_missing")).rows[0].still_missing, true);
  } finally { await db.close(); }
});
