/* eslint-disable @typescript-eslint/no-require-imports -- disposable local PostgreSQL-compatible harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const root = path.resolve(__dirname, "..");
const billing = fs.readFileSync(path.join(root, "supabase/migrations/20261009000000_subscription_billing.sql"), "utf8");
const trial = fs.readFileSync(path.join(root, "supabase/migrations/20261014000000_trial_recurring_payment_methods.sql"), "utf8");
const first = "11111111-1111-4111-8111-111111111111";
const duplicate = "22222222-2222-4222-8222-222222222222";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema agentdesk_private;
    create function extensions.digest(value text, algorithm text) returns bytea language sql immutable as
      $$select decode(md5(value)||md5(value),'hex')$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.usage_limits(user_id uuid primary key references auth.users(id) on delete cascade,plan text default 'free',monthly_limit int default 100,messages_used int default 0,period_start date default date_trunc('month',current_date)::date);
    create table agentdesk_private.ai_usage_reservations(id uuid primary key default gen_random_uuid(),user_id uuid not null,period_start date,released_at timestamptz);
    create function public.security_reserve_ai_usage(p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v public.usage_limits; r uuid; begin
      select * into strict v from public.usage_limits where user_id=p_user_id for update;
      if v.messages_used>=v.monthly_limit then return jsonb_build_object('allowed',false,'plan',v.plan,'used',v.messages_used,'monthly_limit',v.monthly_limit,'remaining',0,'period_start',v.period_start); end if;
      update public.usage_limits set messages_used=messages_used+1 where user_id=p_user_id returning * into v;
      insert into agentdesk_private.ai_usage_reservations(user_id,period_start) values(p_user_id,v.period_start) returning id into r;
      return jsonb_build_object('allowed',true,'plan',v.plan,'used',v.messages_used,'monthly_limit',v.monthly_limit,'remaining',v.monthly_limit-v.messages_used,'period_start',v.period_start,'reservation_id',r);
    end$$;
    create function public.security_release_ai_usage(p_user_id uuid,p_reservation_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
    begin update agentdesk_private.ai_usage_reservations set released_at=now() where id=p_reservation_id and user_id=p_user_id and released_at is null;
      if not found then return false; end if; update public.usage_limits set messages_used=greatest(0,messages_used-1) where user_id=p_user_id; return true; end$$;
  `);
  await db.exec(billing);
  await db.exec(trial);
  return db;
}

test("trial migration executes, reruns, isolates identities and transitions to Free", async () => {
  const db = await database();
  try {
    await db.exec(trial);
    await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at) values
      ('${first}','verified@example.test',now(),now()+interval '1 second'),
      ('${duplicate}','VERIFIED@example.test',now(),now()+interval '1 second')`);
    await db.query(`select public.billing_ensure_free_subscription('${first}')`);
    await db.query(`select public.billing_ensure_trial_entitlement('${first}')`);
    const entitlement = (await db.query(`select credit_limit,status from public.trial_entitlements where user_id='${first}'`)).rows[0];
    assert.equal(entitlement.credit_limit, 250);
    assert.equal(entitlement.status, "active");
    assert.equal((await db.query(`select public.billing_ensure_trial_entitlement('${duplicate}') is null as blocked`)).rows[0].blocked, true);

    await db.exec(`update public.trial_entitlements set credits_used=249 where user_id='${first}'`);
    const lastTrial = (await db.query(`select public.billing_security_reserve_ai_usage('${first}') as value`)).rows[0].value;
    assert.equal(lastTrial.plan, "pro_trial"); assert.equal(lastTrial.remaining, 0);
    assert.equal((await db.query(`select messages_used from public.usage_limits where user_id='${first}'`)).rows[0].messages_used, 0);
    const free = (await db.query(`select public.billing_security_reserve_ai_usage('${first}') as value`)).rows[0].value;
    assert.equal(free.entitlement_source, "free"); assert.equal(free.used, 1);
    assert.equal((await db.query(`select public.billing_security_release_ai_usage('${first}','${lastTrial.reservation_id}') as refunded`)).rows[0].refunded, true);
    assert.equal((await db.query(`select credits_used,status from public.trial_entitlements where user_id='${first}'`)).rows[0].credits_used, 249);

    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from public.trial_entitlements"));
    await assert.rejects(db.query("select * from public.payment_methods"));
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("verified payment-method reconciliation stores display metadata and is idempotent", async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at) values('${first}','pay@example.test',now(),now()+interval '1 second')`);
    await db.query(`select public.billing_ensure_free_subscription('${first}')`);
    await db.exec(`update public.subscriptions set provider='synthetic',provider_customer_ref='cus_1',provider_subscription_ref='sub_1',pending_plan_id='pro',status='incomplete' where user_id='${first}'`);
    const sql = `select public.billing_process_verified_payment_method('synthetic','evt_pm_1','payment_method.attached','cus_1','pm_1','visa','4242',12,2030,now()) as value`;
    assert.equal((await db.query(sql)).rows[0].value.duplicate, false);
    assert.equal((await db.query(sql)).rows[0].value.duplicate, true);
    const method = (await db.query("select brand,last4,is_default,status from public.payment_methods")).rows[0];
    assert.deepEqual(method, { brand: "visa", last4: "4242", is_default: true, status: "active" });
  } finally { await db.close(); }
});

test("trial expires after five days and falls back to the independent Free allowance", async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at)
      values('${first}','expired@example.test',now(),now()+interval '1 second')`);
    await db.query(`select public.billing_ensure_free_subscription('${first}')`);
    await db.query(`select public.billing_ensure_trial_entitlement('${first}')`);
    await db.exec(`update public.trial_entitlements set starts_at=now()-interval '6 days', ends_at=now()-interval '1 day', credits_used=17 where user_id='${first}'`);

    const reservation = (await db.query(`select public.billing_security_reserve_ai_usage('${first}') as value`)).rows[0].value;
    assert.equal(reservation.entitlement_source, "free");
    assert.equal(reservation.used, 1);
    assert.equal(reservation.monthly_limit, 100);
    assert.deepEqual(
      (await db.query(`select status,credits_used from public.trial_entitlements where user_id='${first}'`)).rows[0],
      { status: "expired", credits_used: 17 },
    );
    assert.equal((await db.query(`select count(*)::int as count from auth.users where id='${first}'`)).rows[0].count, 1);
  } finally { await db.close(); }
});

test("trial reservations are serialized and exact refunds cannot be reused", async () => {
  const db = await database();
  try {
    await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at)
      values('${first}','race@example.test',now(),now()+interval '1 second')`);
    await db.query(`select public.billing_ensure_free_subscription('${first}')`);
    await db.query(`select public.billing_ensure_trial_entitlement('${first}')`);
    await db.exec(`update public.trial_entitlements set credits_used=249 where user_id='${first}'`);

    const result = (await db.query(`select public.billing_security_reserve_ai_usage('${first}') as value`)).rows[0].value;
    assert.equal(result.entitlement_source, "trial");
    assert.equal(result.used, 250);
    assert.equal((await db.query(`select public.billing_security_release_ai_usage('${first}','${result.reservation_id}') as value`)).rows[0].value, true);
    assert.equal((await db.query(`select public.billing_security_release_ai_usage('${first}','${result.reservation_id}') as value`)).rows[0].value, false);
    assert.equal((await db.query(`select credits_used from public.trial_entitlements where user_id='${first}'`)).rows[0].credits_used, 249);
  } finally { await db.close(); }
});
