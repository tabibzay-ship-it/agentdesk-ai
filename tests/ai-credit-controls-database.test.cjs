/* eslint-disable @typescript-eslint/no-require-imports -- disposable local PostgreSQL-compatible harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const root = path.resolve(__dirname,"..");
const billing = fs.readFileSync(path.join(root,"supabase/migrations/20261009000000_subscription_billing.sql"),"utf8");
const trial = fs.readFileSync(path.join(root,"supabase/migrations/20261014000000_trial_recurring_payment_methods.sql"),"utf8");
const controls = fs.readFileSync(path.join(root,"supabase/migrations/20261017000000_ai_credit_controls.sql"),"utf8");
const user = "11111111-1111-4111-8111-111111111111";

async function database(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema agentdesk_private;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$select decode(md5(value)||md5(value),'hex')$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz not null default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.super_admins(user_id uuid primary key references auth.users(id),is_active boolean not null default true,mfa_required boolean not null default true);
    create table public.usage_limits(user_id uuid primary key references auth.users(id) on delete cascade,plan text default 'free',monthly_limit int default 100,messages_used int default 0,period_start date default date_trunc('month',current_date)::date);
    create table agentdesk_private.ai_usage_reservations(id uuid primary key default gen_random_uuid(),user_id uuid not null,period_start date,released_at timestamptz);
    create function public.security_reserve_ai_usage(p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
    declare v public.usage_limits;r uuid;begin select * into strict v from public.usage_limits where user_id=p_user_id for update;
      if v.messages_used>=v.monthly_limit then return jsonb_build_object('allowed',false,'plan',v.plan,'used',v.messages_used,'monthly_limit',v.monthly_limit,'remaining',0,'period_start',v.period_start);end if;
      update public.usage_limits set messages_used=messages_used+1 where user_id=p_user_id returning * into v;
      insert into agentdesk_private.ai_usage_reservations(user_id,period_start) values(p_user_id,v.period_start) returning id into r;
      return jsonb_build_object('allowed',true,'plan',v.plan,'used',v.messages_used,'monthly_limit',v.monthly_limit,'remaining',v.monthly_limit-v.messages_used,'period_start',v.period_start,'reservation_id',r);end$$;
    create function public.security_release_ai_usage(p_user_id uuid,p_reservation_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
    begin update agentdesk_private.ai_usage_reservations set released_at=now() where id=p_reservation_id and user_id=p_user_id and released_at is null;
      if not found then return false;end if;update public.usage_limits set messages_used=greatest(0,messages_used-1) where user_id=p_user_id;return true;end$$;
  `);
  await db.exec(billing);await db.exec(trial);await db.exec(controls);return db;
}

test("credit controls migrate idempotently and remain private",async()=>{const db=await database();try{
  await db.exec(controls);
  await db.exec("set role authenticated");
  await assert.rejects(db.query("select * from public.ai_credit_control_config"));
  await assert.rejects(db.query("select * from agentdesk_private.ai_credit_ledger"));
  await db.exec("reset role");
}finally{await db.close()}});

test("operation costs reserve atomically, settle once and retain an audit ledger",async()=>{const db=await database();try{
  await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at) values('${user}','credits@example.test',now(),now()-interval '1 day');select public.billing_ensure_free_subscription('${user}');`);
  const value=(await db.query(`select public.billing_security_reserve_ai_operation('${user}','image_edit',null) as value`)).rows[0].value;
  assert.equal(value.allowed,true);assert.equal(value.credits_charged,5);assert.equal(value.used,5);
  assert.equal((await db.query(`select public.billing_security_settle_ai_operation('${user}','${value.credit_reservation_id}',12,8) as value`)).rows[0].value,true);
  assert.equal((await db.query(`select public.billing_security_settle_ai_operation('${user}','${value.credit_reservation_id}',12,8) as value`)).rows[0].value,false);
  assert.deepEqual((await db.query(`select event_type,credit_delta from agentdesk_private.ai_credit_ledger order by id`)).rows,[{event_type:"reserved",credit_delta:5},{event_type:"settled",credit_delta:0}]);
}finally{await db.close()}});

test("failed work refunds only its exact reservation and cannot refund twice",async()=>{const db=await database();try{
  await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at) values('${user}','refund@example.test',now(),now()-interval '1 day');select public.billing_ensure_free_subscription('${user}');`);
  const value=(await db.query(`select public.billing_security_reserve_ai_operation('${user}','attachment_analysis',null) as value`)).rows[0].value;
  assert.equal((await db.query(`select public.billing_security_release_ai_operation('${user}','${value.credit_reservation_id}') as value`)).rows[0].value,true);
  assert.equal((await db.query(`select public.billing_security_release_ai_operation('${user}','${value.credit_reservation_id}') as value`)).rows[0].value,false);
  assert.equal((await db.query(`select messages_used from public.usage_limits where user_id='${user}'`)).rows[0].messages_used,0);
  assert.equal((await db.query("select sum(credit_delta)::int as net from agentdesk_private.ai_credit_ledger")).rows[0].net,0);
}finally{await db.close()}});

test("one operation never mixes trial credits with the independent Free allowance",async()=>{const db=await database();try{
  await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at) values('${user}','trial-boundary@example.test',now(),now()+interval '1 second');select public.billing_ensure_free_subscription('${user}');select public.billing_ensure_trial_entitlement('${user}');update public.trial_entitlements set credits_used=248 where user_id='${user}';`);
  const value=(await db.query(`select public.billing_security_reserve_ai_operation('${user}','image_edit',null) as value`)).rows[0].value;
  assert.equal(value.allowed,false);assert.equal(value.reason,"insufficient_single_entitlement");
  assert.equal((await db.query(`select credits_used from public.trial_entitlements where user_id='${user}'`)).rows[0].credits_used,248);
  assert.equal((await db.query(`select messages_used from public.usage_limits where user_id='${user}'`)).rows[0].messages_used,0);
  assert.equal((await db.query("select count(*)::int as count from agentdesk_private.ai_credit_reservations")).rows[0].count,0);
}finally{await db.close()}});

test("emergency shutdown and daily limits fail closed before entitlement charging",async()=>{const db=await database();try{
  await db.exec(`insert into auth.users(id,email,email_confirmed_at,created_at) values('${user}','limit@example.test',now(),now()-interval '1 day');select public.billing_ensure_free_subscription('${user}');update public.ai_credit_control_config set emergency_shutdown=true;`);
  let value=(await db.query(`select public.billing_security_reserve_ai_operation('${user}','text_chat',null) as value`)).rows[0].value;
  assert.equal(value.reason,"provider_disabled");
  await db.exec("update public.ai_credit_control_config set emergency_shutdown=false,per_user_daily_credit_limit=1");
  value=(await db.query(`select public.billing_security_reserve_ai_operation('${user}','text_chat',null) as value`)).rows[0].value;assert.equal(value.allowed,true);
  value=(await db.query(`select public.billing_security_reserve_ai_operation('${user}','text_chat',null) as value`)).rows[0].value;assert.equal(value.reason,"daily_user_limit");
  assert.equal((await db.query(`select messages_used from public.usage_limits where user_id='${user}'`)).rows[0].messages_used,1);
}finally{await db.close()}});
