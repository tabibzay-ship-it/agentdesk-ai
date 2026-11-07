-- REVIEW ARTIFACT ONLY. DO NOT EXECUTE WITHOUT SEPARATE EXPLICIT APPROVAL.
-- This file is deliberately outside supabase/migrations so migration discovery
-- cannot apply it. It baselines five schema-equivalent historical layers; it
-- does not execute those migration files.

\set ON_ERROR_STOP on
\if :{?AGENTDESK_APPROVE_PRODUCTION_LEDGER_BASELINE}
\else
  \echo 'BLOCKED: set AGENTDESK_APPROVE_PRODUCTION_LEDGER_BASELINE only in the separately approved production window.'
  \quit
\endif

begin;
set local statement_timeout = '30s';
set local lock_timeout = '3s';
set local idle_in_transaction_session_timeout = '45s';

do $baseline_guard$
declare
  missing text[] := '{}';
  item text;
begin
  if current_database() <> 'postgres' then
    raise exception 'Expected database postgres, got %', current_database();
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    raise exception 'Migration ledger already exists; baseline plan requires fresh reconciliation.';
  end if;

  foreach item in array array[
    'public.business_profiles','public.knowledge_sources','public.agent_settings',
    'public.widget_settings','public.conversations','public.messages','public.usage_limits',
    'agentdesk_private.chat_rate_buckets','agentdesk_private.ai_usage_reservations',
    'public.subscription_plans','public.subscriptions','public.billing_events',
    'public.payment_transactions','public.chat_attachments'
  ] loop
    if to_regclass(item) is null then missing := array_append(missing,item); end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'Missing first-five relations: %', array_to_string(missing,', ');
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agent_settings'
      and column_name='allowed_domains' and data_type='ARRAY' and udt_name='_text'
  ) then raise exception 'Missing or incompatible agent_settings.allowed_domains'; end if;

  foreach item in array array[
    'public.reserve_ai_usage(uuid)',
    'public.release_ai_usage(uuid,date)',
    'public.check_chat_rate_limit(uuid,text,integer,integer)',
    'public.security_reserve_ai_usage(uuid)',
    'public.security_release_ai_usage(uuid,uuid)',
    'public.billing_ensure_free_subscription(uuid)',
    'public.billing_security_reserve_ai_usage(uuid)',
    'public.billing_process_verified_event(text,text,text,text,text,text,text,text,timestamp with time zone)'
  ] loop
    if to_regprocedure(item) is null then
      raise exception 'Missing first-five function: %', item;
    end if;
  end loop;

  foreach item in array array[
    'knowledge_sources_user_created_idx','conversations_user_created_idx',
    'conversations_user_visitor_idx','messages_conversation_created_idx',
    'subscriptions_provider_customer_unique','subscriptions_provider_subscription_unique',
    'subscriptions_status_period_end_idx','billing_events_user_created_idx',
    'payment_transactions_user_created_idx','chat_attachments_owner_visitor_idx',
    'chat_attachments_conversation_idx','chat_attachments_message_idx'
  ] loop
    if to_regclass('public.'||item) is null then
      raise exception 'Missing first-five index: %', item;
    end if;
  end loop;

  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','agentdesk_private')
      and c.relname in (
        'business_profiles','knowledge_sources','agent_settings','widget_settings',
        'conversations','messages','usage_limits','chat_rate_buckets',
        'ai_usage_reservations','subscription_plans','subscriptions',
        'billing_events','payment_transactions','chat_attachments'
      ) and (not c.relrowsecurity or (n.nspname='public' and not c.relforcerowsecurity))
  ) then raise exception 'First-five RLS/forced-RLS invariant failed'; end if;

  if not exists(select 1 from storage.buckets where id='chat-attachments' and public is false) then
    raise exception 'Private chat-attachments storage bucket is missing';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema in ('public','agentdesk_private')
      and table_name in (
        'chat_rate_buckets','ai_usage_reservations','subscriptions',
        'billing_events','payment_transactions','chat_attachments'
      ) and grantee in ('anon','authenticated')
  ) then raise exception 'Browser role retains a forbidden private-table grant'; end if;
end
$baseline_guard$;

create schema supabase_migrations;
revoke all on schema supabase_migrations from public, anon, authenticated;

-- Matches the current Supabase CLI ledger shape. Recheck against the exact CLI
-- version selected for the approved window before execution.
create table supabase_migrations.schema_migrations (
  version text primary key,
  statements text[] not null default '{}',
  name text
);
revoke all on supabase_migrations.schema_migrations from public, anon, authenticated;

insert into supabase_migrations.schema_migrations(version,statements,name) values
  ('20261006000000','{}','initial_application_schema'),
  ('20261007000000','{}','add_agent_allowed_domains'),
  ('20261007010000','{}','security_hardening'),
  ('20261009000000','{}','subscription_billing'),
  ('20261010000000','{}','chat_attachments');

do $baseline_verify$
declare
  versions text[];
begin
  select array_agg(version order by version) into versions
  from supabase_migrations.schema_migrations;
  if versions <> array[
    '20261006000000','20261007000000','20261007010000',
    '20261009000000','20261010000000'
  ]::text[] then
    raise exception 'Unexpected migration baseline: %', versions;
  end if;
end
$baseline_verify$;

-- The approved operator must inspect the five returned rows before COMMIT.
table supabase_migrations.schema_migrations;
commit;
