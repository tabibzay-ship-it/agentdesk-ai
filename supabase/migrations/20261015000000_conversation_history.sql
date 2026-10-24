-- Add durable conversation management without granting browser write access.
begin;

alter table public.conversations
  add column if not exists title text not null default 'New conversation',
  add column if not exists updated_at timestamptz not null default now();

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_title_length'
  ) then
    alter table public.conversations
      add constraint conversations_title_length
      check (length(btrim(title)) between 1 and 120);
  end if;
end
$constraints$;

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc, id desc);

create or replace function public.agentdesk_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.conversations
  set updated_at = greatest(updated_at, new.created_at)
  where id = new.conversation_id;
  return new;
end
$function$;

revoke all on function public.agentdesk_touch_conversation() from public, anon, authenticated;
grant execute on function public.agentdesk_touch_conversation() to service_role;

drop trigger if exists agentdesk_touch_conversation_after_message on public.messages;
create trigger agentdesk_touch_conversation_after_message
after insert on public.messages
for each row execute function public.agentdesk_touch_conversation();

-- Conversation management remains server-only. Existing owner SELECT policy is
-- retained; authenticated clients cannot rename or delete rows directly.
revoke insert, update, delete on public.conversations from public, anon, authenticated;

commit;
