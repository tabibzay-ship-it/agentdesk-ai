/* eslint-disable @typescript-eslint/no-require-imports -- isolated PostgreSQL-compatible test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");

const runtimeRoot = process.env.AGENTDESK_PGLITE_ROOT;
const skip = !runtimeRoot && "Temporary PostgreSQL test runtime is not configured";
const baseMigration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261009000000_subscription_billing.sql"), "utf8");
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261018000000_nowpayments.sql"), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function database() {
  const dependencies = createRequire(path.join(runtimeRoot, "package.json"));
  const { PGlite } = dependencies("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'),('${other}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.usage_limits(user_id uuid primary key references auth.users(id),plan text not null default 'free',monthly_limit integer not null default 100,messages_used integer not null default 0,period_start date not null default current_date);
    create function public.security_reserve_ai_usage(p_user_id uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
  `);
  await db.exec(baseMigration);
  await db.exec(`create table public.trial_entitlements(user_id uuid primary key references auth.users(id),status text not null,ended_at timestamptz,updated_at timestamptz not null default now());`);
  await db.exec(migration);
  return db;
}

async function reconcile(db, order, payment, status, amount = 9) {
  return db.query(`select public.billing_process_nowpayments_ipn('${order}','${payment}','${status}',${amount},'USD','2026-10-25T12:00:00Z') as result`);
}

test("NOWPayments migration activates once, rejects mismatches, and extends an authorized renewal", { skip }, async () => {
  const db = await database();
  try {
    await db.query(`select public.billing_ensure_free_subscription('${owner}')`);
    const initial = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query(`insert into public.nowpayments_payment_orders(order_id,user_id,plan_code,amount_cents,currency,kind,status) values('${initial}','${owner}','starter',900,'USD','initial','waiting')`);
    assert.equal((await reconcile(db, initial, "payment-1", "confirmed")).rows[0].result.activated, true);
    const before = (await db.query(`select current_period_end from public.subscriptions where user_id='${owner}'`)).rows[0].current_period_end;
    assert.equal((await reconcile(db, initial, "payment-1", "confirmed")).rows[0].result.duplicate, true);
    assert.equal((await reconcile(db, initial, "payment-1", "finished")).rows[0].result.activated, false);
    assert.equal((await db.query(`select current_period_end from public.subscriptions where user_id='${owner}'`)).rows[0].current_period_end.toISOString(), before.toISOString());

    const renewal = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await db.query(`insert into public.nowpayments_payment_orders(order_id,user_id,plan_code,amount_cents,currency,kind,status) values('${renewal}','${owner}','starter',900,'USD','renewal','waiting')`);
    assert.equal((await reconcile(db, renewal, "payment-2", "confirmed")).rows[0].result.activated, true);
    const after = (await db.query(`select current_period_end from public.subscriptions where user_id='${owner}'`)).rows[0].current_period_end;
    assert.ok(after > before);
    assert.equal((await db.query(`select count(*)::int as count from public.payment_transactions where user_id='${owner}'`)).rows[0].count, 2);

    const bad = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.query(`insert into public.nowpayments_payment_orders(order_id,user_id,plan_code,amount_cents,currency,kind,status) values('${bad}','${other}','pro',2900,'USD','initial','waiting')`);
    await assert.rejects(reconcile(db, bad, "payment-3", "confirmed", 9));
  } finally { await db.close(); }
});

test("NOWPayments private ledger and reconciliation function deny browser roles", { skip }, async () => {
  const db = await database();
  try {
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.nowpayments_payment_orders"));
    await assert.rejects(db.query("select public.billing_process_nowpayments_ipn('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','confirmed',9,'USD',now())"));
  } finally { await db.exec("reset role"); await db.close(); }
});
