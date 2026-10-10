-- Private, account-scoped chat attachments. Apply locally first; production is not authorized.
create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  visitor_id text not null check (length(visitor_id) between 36 and 80),
  storage_path text not null unique check (storage_path !~ '(?:^|/)\.\.(?:/|$)'),
  original_name text not null check (length(original_name) between 1 and 180),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('image','document')),
  processing_status text not null check (processing_status in ('ready','failed')),
  extracted_text text,
  created_at timestamptz not null default now(),
  constraint chat_attachment_account_match check (agent_id = user_id)
);

create index if not exists chat_attachments_owner_visitor_idx on public.chat_attachments(user_id, visitor_id, created_at);
create index if not exists chat_attachments_conversation_idx on public.chat_attachments(conversation_id, created_at);
create index if not exists chat_attachments_message_idx on public.chat_attachments(message_id) where message_id is not null;

alter table public.chat_attachments enable row level security;
alter table public.chat_attachments force row level security;
revoke all on table public.chat_attachments from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_attachments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-attachments', 'chat-attachments', false, 10485760, array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Browser clients deliberately receive no direct storage policies. All access
-- passes through authenticated server routes that re-check account ownership.
