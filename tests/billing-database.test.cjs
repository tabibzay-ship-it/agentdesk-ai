/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL-compatible test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const runtimeRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !runtimeRoot && "Temporary PostgreSQL test runtime is not configured";
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261009000000_subscription_billing.sql"), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function baseDatabase(applyMigration = true) {
  const dependencies = createRequire(path.join(runtimeRoot, "package.json"));
  const { PGlite } = dependencies("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    create table public.usage_limits(
      user_id uuid primary key references auth.users(id) on delete cascade,
      plan text not null default 'free', monthly_limit integer not null default 100,
      messages_used integer not null default 0,
      period_start date not null default date_trunc('month',current_date)::date
    );
    create function public.security_reserve_ai_usage(p_user_id uuid) returns jsonb
    language plpgsql security definer set search_path='' as $$
    declare v_row public.usage_limits;
    begin
      perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
      select * into strict v_row from public.usage_limits where user_id=p_user_id for update;
      if v_row.messages_used < v_row.monthly_limit then
        update public.usage_limits set messages_used=messages_used+1 where user_id=p_user_id returning * into v_row;
        return jsonb_build_object('allowed',true,'plan',v_row.plan,'used',v_row.messages_used,'monthly_limit',v_row.monthly_limit,'remaining',v_row.monthly_limit-v_row.messages_used,'period_start',v_row.period_start);
      end if;
      return jsonb_build_object('allowed',false,'plan',v_row.plan,'used',v_row.messages_used,'monthly_limit',v_row.monthly_limit,'remaining',0,'period_start',v_row.period_start);
    end$$;
    revoke all on function public.security_reserve_ai_usage(uuid) from public,anon,authenticated;
    grant all on public.usage_limits to service_role;
    grant execute on function public.security_reserve_ai_usage(uuid) to service_role;
  `);
  if (applyMigration) await db.exec(migration);
  return db;
}

async function asService(db, sql) {
  await db.exec("set role service_role");
  try { return await db.query(sql); }
  finally { await db.exec("reset role"); }
}

test("billing migration executes with the expected catalog, constraints, foreign keys and indexes", { skip }, async () => {
  const db = await baseDatabase();
  try {
    const plans = await db.query("select code,price_cents,agent_limit,monthly_response_limit from public.subscription_plans order by display_order");
    assert.deepEqual(plans.rows, [
      { code: "free", price_cents: 0, agent_limit: 1, monthly_response_limit: 100 },
      { code: "starter", price_cents: 900, agent_limit: 3, monthly_response_limit: 2000 },
      { code: "pro", price_cents: 2900, agent_limit: 10, monthly_response_limit: 10000 },
    ]);
    const indexes = await db.query("select indexname from pg_indexes where schemaname='public' and tablename in ('subscriptions','billing_events','payment_transactions')");
    for (const name of ["subscriptions_user_id_key","subscriptions_provider_customer_unique","subscriptions_provider_subscription_unique","billing_events_provider_provider_event_id_key","payment_transactions_provider_provider_transaction_ref_key"]) {
      assert.ok(indexes.rows.some((row) => row.indexname === name), name);
    }
    await assert.rejects(db.query("insert into public.subscription_plans(code,name,description,price_cents,currency,agent_limit,monthly_response_limit) values('bad','Bad','Bad plan',-1,'usd',0,0)"));
  } finally { await db.close(); }
});

test("migration is transaction-safe and rolls back cleanly on a later failure", { skip }, async () => {
  const db = await baseDatabase(false);
  try {
    await db.exec("begin");
    await db.exec(migration);
    await assert.rejects(db.query("insert into public.subscription_plans(code,name,description,price_cents,currency,agent_limit,monthly_response_limit) values('broken','Broken','Broken plan',-1,'USD',1,1)"));
    await db.exec("rollback");
    assert.equal((await db.query("select to_regclass('public.subscriptions') is null as absent")).rows[0].absent, true);
  } finally { await db.close(); }
});

test("migration reruns preserve configured plan values and existing subscriptions", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await db.query("update public.subscription_plans set price_cents=950 where code='starter'");
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    const id = (await db.query(`select id from public.subscriptions where user_id='${owner}'`)).rows[0].id;
    await db.exec(migration);
    assert.equal((await db.query("select price_cents from public.subscription_plans where code='starter'")).rows[0].price_cents, 950);
    assert.equal((await db.query(`select id from public.subscriptions where user_id='${owner}'`)).rows[0].id, id);
  } finally { await db.close(); }
});

test("free subscription creation is idempotent and does not overwrite existing usage", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    assert.equal((await db.query(`select count(*)::int as count from public.subscriptions where user_id='${owner}'`)).rows[0].count, 1);
    await db.query(`update public.usage_limits set messages_used=27 where user_id='${owner}'`);
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    assert.equal((await db.query(`select messages_used from public.usage_limits where user_id='${owner}'`)).rows[0].messages_used, 27);
  } finally { await db.close(); }
});

test("browser roles cannot read private billing rows, write plans, or execute billing functions", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}'`);
    assert.equal((await db.query("select count(*)::int as count from public.subscription_plans")).rows[0].count, 3);
    for (const table of ["subscriptions","billing_events","payment_transactions"]) await assert.rejects(db.query(`select * from public.${table}`));
    await assert.rejects(db.query("update public.subscription_plans set price_cents=0 where code='pro'"));
    await assert.rejects(db.query(`select public.billing_ensure_free_subscription('${other}')`));
    await assert.rejects(db.query(`select public.billing_security_reserve_ai_usage('${owner}')`));
  } finally { await db.exec("reset role"); await db.close(); }
});

test("verified Starter and Pro events reconcile server mappings and remain idempotent", { skip }, async () => {
  const db = await baseDatabase();
  try {
    for (const [user, plan, customer, subscription, event, transaction, limit] of [
      [owner,"starter","cus-a","sub-a","evt-a","txn-a",2000],
      [other,"pro","cus-b","sub-b","evt-b","txn-b",10000],
    ]) {
      await asService(db, `select public.billing_ensure_free_subscription('${user}')`);
      await db.query("update public.subscriptions set pending_plan_id=$2,status='incomplete',provider='test',provider_customer_ref=$3,provider_subscription_ref=$4 where user_id=$1", [user,plan,customer,subscription]);
      const call = `select public.billing_process_verified_event('test','${event}','subscription.active','${customer}','${subscription}','${transaction}','${plan}','active',now()) as result`;
      assert.equal((await asService(db, call)).rows[0].result.duplicate, false);
      assert.equal((await asService(db, call)).rows[0].result.duplicate, true);
      assert.deepEqual((await db.query("select plan_id,status,pending_plan_id from public.subscriptions where user_id=$1", [user])).rows[0], { plan_id: plan, status: "active", pending_plan_id: null });
      assert.equal((await db.query("select monthly_limit from public.usage_limits where user_id=$1", [user])).rows[0].monthly_limit, limit);
    }
    assert.equal((await db.query("select count(*)::int as count from public.billing_events")).rows[0].count, 2);
    assert.equal((await db.query("select count(*)::int as count from public.payment_transactions")).rows[0].count, 2);
  } finally { await db.close(); }
});

test("expired and canceled subscriptions fall back to Free before atomic quota reservation", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    await db.exec(`update public.subscriptions set plan_id='starter',status='active',provider='test',provider_customer_ref='cus-exp',provider_subscription_ref='sub-exp',current_period_start=now()-interval '2 months',current_period_end=now()-interval '1 month' where user_id='${owner}'; update public.usage_limits set plan='starter',monthly_limit=2000,messages_used=99 where user_id='${owner}'`);
    const expired = (await asService(db, `select public.billing_security_reserve_ai_usage('${owner}') as usage`)).rows[0].usage;
    assert.equal(expired.allowed, true);
    assert.equal(expired.monthly_limit, 100);
    assert.deepEqual((await db.query(`select plan_id,status,provider from public.subscriptions where user_id='${owner}'`)).rows[0], { plan_id: "free", status: "active", provider: null });

    await db.exec(`update public.subscriptions set plan_id='pro',status='canceled',provider='test',provider_customer_ref='cus-cancel',provider_subscription_ref='sub-cancel',current_period_end=now()+interval '1 month' where user_id='${owner}'; update public.usage_limits set plan='pro',monthly_limit=10000,messages_used=100 where user_id='${owner}'`);
    const canceled = (await asService(db, `select public.billing_security_reserve_ai_usage('${owner}') as usage`)).rows[0].usage;
    assert.equal(canceled.allowed, false);
    assert.equal(canceled.monthly_limit, 100);
  } finally { await db.close(); }
});

test("concurrent Free quota reservations cannot exceed the monthly limit", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    await db.query(`update public.usage_limits set messages_used=99 where user_id='${owner}'`);
    await db.exec("set role service_role");
    const results = await Promise.all(Array.from({ length: 5 }, () => db.query(`select public.billing_security_reserve_ai_usage('${owner}') as usage`)));
    assert.equal(results.filter((result) => result.rows[0].usage.allowed).length, 1);
    assert.equal((await db.query(`select messages_used from public.usage_limits where user_id='${owner}'`)).rows[0].messages_used, 100);
  } finally { await db.exec("reset role"); await db.close(); }
});

test("duplicate cancellation stays idempotent after provider mappings are cleared", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    await db.exec(`update public.subscriptions set plan_id='starter',status='active',provider='test',provider_customer_ref='cus-old',provider_subscription_ref='sub-old',current_period_end=now()+interval '1 month' where user_id='${owner}'; update public.usage_limits set plan='starter',monthly_limit=2000 where user_id='${owner}'`);
    const cancel = `select public.billing_process_verified_event('test','evt-cancel','subscription.canceled','cus-old','sub-old',null,'starter','canceled',now()) as result`;
    assert.equal((await asService(db, cancel)).rows[0].result.duplicate, false);
    await asService(db, `select public.billing_security_reserve_ai_usage('${owner}')`);
    assert.equal((await asService(db, cancel)).rows[0].result.duplicate, true);
    assert.equal((await db.query("select count(*)::int as count from public.billing_events where provider_event_id='evt-cancel'")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("out-of-order provider events are audited without regressing entitlement state", { skip }, async () => {
  const db = await baseDatabase();
  try {
    await asService(db, `select public.billing_ensure_free_subscription('${owner}')`);
    await db.query(`update public.subscriptions set pending_plan_id='pro',status='incomplete',provider='test',provider_customer_ref='cus-order',provider_subscription_ref='sub-order' where user_id=$1`, [owner]);
    await asService(db, `select public.billing_process_verified_event('test','evt-new','subscription.active','cus-order','sub-order','txn-new','pro','active','2026-10-09T12:00:00Z')`);
    const stale = (await asService(db, `select public.billing_process_verified_event('test','evt-old','subscription.canceled','cus-order','sub-order',null,'pro','canceled','2026-10-08T12:00:00Z') as result`)).rows[0].result;
    assert.equal(stale.ignored, true);
    const subscription = (await db.query("select plan_id,status,provider_event_at from public.subscriptions where user_id=$1", [owner])).rows[0];
    assert.deepEqual({ plan_id: subscription.plan_id, status: subscription.status }, { plan_id: "pro", status: "active" });
    assert.equal(new Date(subscription.provider_event_at).toISOString(), "2026-10-09T12:00:00.000Z");
    assert.equal((await db.query("select outcome from public.billing_events where provider_event_id='evt-old'")).rows[0].outcome, "ignored");
  } finally { await db.close(); }
});

test("a logical staging snapshot restores subscriptions and billing history consistently", { skip }, async () => {
  const source = await baseDatabase();
  let restored;
  try {
    await asService(source, `select public.billing_ensure_free_subscription('${owner}')`);
    await source.query("update public.subscriptions set pending_plan_id='starter',status='incomplete',provider='test',provider_customer_ref='cus-backup',provider_subscription_ref='sub-backup' where user_id=$1", [owner]);
    await asService(source, `select public.billing_process_verified_event('test','evt-backup','subscription.active','cus-backup','sub-backup','txn-backup','starter','active','2026-10-09T12:00:00Z')`);
    const snapshot = {
      subscription: (await source.query("select id,user_id,plan_id,pending_plan_id,status,billing_period,current_period_start,current_period_end,cancel_at_period_end,canceled_at,provider,provider_customer_ref,provider_subscription_ref,created_at,updated_at from public.subscriptions where user_id=$1", [owner])).rows[0],
      usage: (await source.query("select user_id,plan,monthly_limit,messages_used,period_start from public.usage_limits where user_id=$1", [owner])).rows[0],
      event: (await source.query("select id,user_id,subscription_id,provider,provider_event_id,event_type,outcome,occurred_at,processed_at,created_at from public.billing_events where user_id=$1", [owner])).rows[0],
      transaction: (await source.query("select id,user_id,subscription_id,provider,provider_transaction_ref,amount_cents,currency,status,occurred_at,created_at,updated_at from public.payment_transactions where user_id=$1", [owner])).rows[0],
    };

    restored = await baseDatabase();
    await restored.query(`insert into public.subscriptions(id,user_id,plan_id,pending_plan_id,status,billing_period,current_period_start,current_period_end,cancel_at_period_end,canceled_at,provider,provider_customer_ref,provider_subscription_ref,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, Object.values(snapshot.subscription));
    await restored.query("insert into public.usage_limits(user_id,plan,monthly_limit,messages_used,period_start) values($1,$2,$3,$4,$5)", Object.values(snapshot.usage));
    await restored.query(`insert into public.billing_events(id,user_id,subscription_id,provider,provider_event_id,event_type,outcome,occurred_at,processed_at,created_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, Object.values(snapshot.event));
    await restored.query(`insert into public.payment_transactions(id,user_id,subscription_id,provider,provider_transaction_ref,amount_cents,currency,status,occurred_at,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, Object.values(snapshot.transaction));

    assert.deepEqual((await restored.query("select plan_id,status,provider_subscription_ref from public.subscriptions where user_id=$1", [owner])).rows[0], { plan_id: "starter", status: "active", provider_subscription_ref: "sub-backup" });
    assert.deepEqual((await restored.query("select plan,monthly_limit,messages_used from public.usage_limits where user_id=$1", [owner])).rows[0], { plan: "starter", monthly_limit: 2000, messages_used: 0 });
    assert.equal((await restored.query("select count(*)::int as count from public.billing_events where user_id=$1", [owner])).rows[0].count, 1);
    assert.equal((await restored.query("select count(*)::int as count from public.payment_transactions where user_id=$1", [owner])).rows[0].count, 1);
    assert.equal((await asService(restored, `select public.billing_process_verified_event('test','evt-backup','subscription.active','cus-backup','sub-backup','txn-backup','starter','active','2026-10-09T12:00:00Z') as result`)).rows[0].result.duplicate, true);
  } finally {
    await source.close();
    if (restored) await restored.close();
  }
});
