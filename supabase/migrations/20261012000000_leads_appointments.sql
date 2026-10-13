-- AgentDesk CRM and booking. Prepared locally; production execution requires separate approval.
alter table public.widget_settings add column if not exists position text not null default 'right' check (position in ('left','right'));
alter table public.widget_settings add column if not exists size text not null default 'standard' check (size in ('compact','standard','large'));
alter table public.widget_settings add column if not exists theme text not null default 'system' check (theme in ('light','dark','system'));
alter table public.widget_settings add column if not exists locale text not null default 'en' check (locale in ('en','ps','fa'));

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  name text not null check (length(name) between 1 and 120),
  email text check (email is null or length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  company text check (company is null or length(company) <= 160),
  source text not null default 'manual' check (source in ('manual','conversation','widget','booking')),
  status text not null default 'new' check (status in ('new','contacted','qualified','converted')),
  notes text not null default '' check (length(notes) <= 5000),
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_user_created_idx on public.leads(user_id, created_at desc);
create index if not exists leads_user_status_idx on public.leads(user_id, status, created_at desc);
create unique index if not exists leads_user_email_unique on public.leads(user_id, lower(email)) where email is not null and email <> '';

create table if not exists public.lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  due_at timestamptz not null,
  note text not null check (length(note) between 1 and 1000),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lead_followups_owner_due_idx on public.lead_follow_ups(user_id, due_at);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_name text not null check (length(customer_name) between 1 and 120),
  customer_email text check (customer_email is null or length(customer_email) <= 254),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 40),
  service text not null check (length(service) between 1 and 160),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null check (length(timezone) between 1 and 80),
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled','no_show')),
  notes text not null default '' check (length(notes) <= 5000),
  reminder_status text not null default 'disabled' check (reminder_status in ('disabled','pending','sent','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_valid_interval check (ends_at > starts_at)
);
create index if not exists appointments_user_start_idx on public.appointments(user_id, starts_at);
create index if not exists appointments_user_status_idx on public.appointments(user_id, status, starts_at);
create unique index if not exists appointments_active_slot_unique on public.appointments(user_id, starts_at, ends_at)
  where status in ('pending','confirmed');

create table if not exists public.business_availability (
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null check (length(timezone) between 1 and 80),
  enabled boolean not null default true,
  primary key(user_id, weekday),
  constraint availability_valid_interval check (end_time > start_time)
);

alter table public.leads enable row level security; alter table public.leads force row level security;
alter table public.lead_follow_ups enable row level security; alter table public.lead_follow_ups force row level security;
alter table public.appointments enable row level security; alter table public.appointments force row level security;
alter table public.business_availability enable row level security; alter table public.business_availability force row level security;
revoke all on public.leads, public.lead_follow_ups, public.appointments, public.business_availability from public, anon, authenticated;
grant select, insert, update, delete on public.leads, public.lead_follow_ups, public.appointments, public.business_availability to service_role;
