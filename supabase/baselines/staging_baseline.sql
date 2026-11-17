-- Reproducible AgentDesk application baseline for new environments.
-- This migration creates schema only. It contains no production/customer data.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null,
  description text not null default '',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_sources_user_created_idx on public.knowledge_sources(user_id, created_at);

create table if not exists public.agent_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  public_agent_id uuid not null unique default gen_random_uuid(),
  is_active boolean not null default true,
  tone text not null default 'professional',
  custom_instructions text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.widget_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  agent_name text not null default 'AI Support Assistant',
  welcome_message text not null default 'Hi! How can I help you today?',
  primary_color text not null default '#2563eb',
  is_installed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  visitor_id text,
  customer_name text,
  customer_email text,
  created_at timestamptz not null default now()
);
create index if not exists conversations_user_created_idx on public.conversations(user_id, created_at desc);
create index if not exists conversations_user_visitor_idx on public.conversations(user_id, visitor_id, created_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

create table if not exists public.usage_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  monthly_limit integer not null default 100 check (monthly_limit > 0),
  messages_used integer not null default 0 check (messages_used >= 0),
  period_start date not null default date_trunc('month', current_date)::date
);

create or replace function public.reserve_ai_usage(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone = 'UTC'
as $function$
declare
  v_usage public.usage_limits;
  v_month date := date_trunc('month', current_date)::date;
begin
  if p_user_id is null then raise exception 'Missing account'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  insert into public.usage_limits(user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.usage_limits
    set messages_used = case when period_start = v_month then messages_used else 0 end,
        period_start = v_month
    where user_id = p_user_id
    returning * into strict v_usage;
  if v_usage.messages_used >= v_usage.monthly_limit then
    return jsonb_build_object('allowed',false,'plan',v_usage.plan,'used',v_usage.messages_used,
      'monthly_limit',v_usage.monthly_limit,'remaining',0,'period_start',v_usage.period_start);
  end if;
  update public.usage_limits set messages_used=messages_used+1 where user_id=p_user_id returning * into strict v_usage;
  return jsonb_build_object('allowed',true,'plan',v_usage.plan,'used',v_usage.messages_used,
    'monthly_limit',v_usage.monthly_limit,'remaining',v_usage.monthly_limit-v_usage.messages_used,
    'period_start',v_usage.period_start);
end
$function$;

create or replace function public.release_ai_usage(p_user_id uuid, p_period_start date)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.usage_limits set messages_used=greatest(0,messages_used-1)
  where user_id=p_user_id and period_start=p_period_start;
$function$;

revoke all on function public.reserve_ai_usage(uuid) from public, anon, authenticated;
revoke all on function public.release_ai_usage(uuid,date) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid) to service_role;
grant execute on function public.release_ai_usage(uuid,date) to service_role;

-- The following migration installs the final forced-RLS policies and precise
-- grants. Enable RLS here as a fail-closed guard if that later step aborts.
alter table public.business_profiles enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.agent_settings enable row level security;
alter table public.widget_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.usage_limits enable row level security;
