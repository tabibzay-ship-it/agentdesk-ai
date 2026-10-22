begin;

create table if not exists public.chat_request_keys (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  visitor_id text not null check (char_length(visitor_id) between 16 and 160),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'processing' check (status in ('processing', 'completed')),
  response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'processing' and response is null) or (status = 'completed' and response is not null))
);

create index if not exists chat_request_keys_user_created_idx
  on public.chat_request_keys(user_id, created_at desc);

alter table public.chat_request_keys enable row level security;
alter table public.chat_request_keys force row level security;
revoke all on table public.chat_request_keys from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_request_keys to service_role;

commit;
