\set ON_ERROR_STOP on
create or replace function pg_temp.assert_true(value boolean,message text)
returns void language plpgsql as $$begin if value is not true then raise exception 'ASSERTION FAILED: %',message;end if;end$$;

set role service_role;
insert into public.conversations(id,user_id,visitor_id,title,created_at,updated_at) values
  ('31111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','dashboard-test-11111111-1111-4111-8111-111111111111','Account A history',now(),now()),
  ('32222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','dashboard-test-22222222-2222-4222-8222-222222222222','Account B history',now(),now())
on conflict(id) do nothing;
insert into public.messages(id,conversation_id,role,content,created_at) values
  ('41111111-1111-4111-8111-111111111111','31111111-1111-4111-8111-111111111111','user','Synthetic account A',now()),
  ('42222222-2222-4222-8222-222222222222','32222222-2222-4222-8222-222222222222','user','Synthetic account B',now())
on conflict(id) do nothing;
insert into public.chat_attachments(id,user_id,agent_id,conversation_id,visitor_id,storage_path,original_name,mime_type,size_bytes,sha256,kind,processing_status)
values
  ('51111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','31111111-1111-4111-8111-111111111111','dashboard-test-11111111-1111-4111-8111-111111111111','11111111/a.txt','a.txt','text/plain',1,repeat('a',64),'document','ready'),
  ('52222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','32222222-2222-4222-8222-222222222222','dashboard-test-22222222-2222-4222-8222-222222222222','22222222/b.txt','b.txt','text/plain',1,repeat('b',64),'document','ready')
on conflict(id) do nothing;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select pg_temp.assert_true((select count(*)=1 from public.conversations),'account A must see exactly its conversation');
select pg_temp.assert_true((select bool_and(user_id='11111111-1111-4111-8111-111111111111') from public.conversations),'account A must not see account B history');
select pg_temp.assert_true((select count(*)=1 from public.messages),'account A must see exactly its message');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.chat_attachments','select'),'browser attachment reads must be server-only');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.chat_request_keys','select'),'browser retry-key reads must be server-only');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select pg_temp.assert_true((select count(*)=1 from public.conversations),'account B must see exactly its conversation');
select pg_temp.assert_true((select bool_and(user_id='22222222-2222-4222-8222-222222222222') from public.conversations),'account B must not see account A history');
select pg_temp.assert_true((select count(*)=1 from public.messages),'account B must see exactly its message');
reset role;

select pg_temp.assert_true((select count(*)=2 from public.chat_attachments),'service-side synthetic attachments must be preserved');
select pg_temp.assert_true((select count(*)=2 from public.conversations),'both tenant histories must remain durable');
select 'CHAT_CREDIT_TENANT_ISOLATION_PG17_PASS' as result;
