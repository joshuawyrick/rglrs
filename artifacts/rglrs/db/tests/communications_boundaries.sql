-- Task 11 communications/discovery boundaries. All fixtures roll back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000001','authenticated','authenticated','comm-a@example.test','',now(),'{}','{"full_name":"Comm A"}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000002','authenticated','authenticated','comm-b@example.test','',now(),'{}','{"full_name":"Comm B"}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000003','authenticated','authenticated','comm-c@example.test','',now(),'{}','{"full_name":"Comm C"}',now(),now()),
('00000000-0000-0000-0000-000000000000','b1000000-0000-0000-0000-000000000004','authenticated','authenticated','comm-outsider@example.test','',now(),'{}','{"full_name":"Hidden Person"}',now(),now());

insert into public.friendships(requester_id,addressee_id,status) values
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','accepted'),
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000003','accepted'),
('b1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000003','accepted');

do $$ begin
  if has_table_privilege('authenticated','public.conversations','insert')
    or has_table_privilege('authenticated','public.conversation_members','insert')
    or has_table_privilege('authenticated','public.messages','insert')
    or has_table_privilege('authenticated','public.message_media','insert')
    or has_table_privilege('authenticated','public.notifications','insert')
    or has_table_privilege('authenticated','public.notifications','delete')
  then raise exception 'direct communications mutation remains enabled'; end if;
  if has_table_privilege('authenticated','public.message_media','select')
     or has_column_privilege('authenticated','public.message_media','object_key','select')
     or has_column_privilege('anon','public.message_media','object_key','select')
     or not has_column_privilege('authenticated','public.message_media','id','select')
     or not has_column_privilege('authenticated','public.message_media','media_type','select')
     or not has_column_privilege('authenticated','public.message_media','sort_order','select')
  then raise exception 'message media browser column boundary is incorrect'; end if;
  if has_function_privilege('anon','public.send_message_secure(uuid,text,uuid,uuid[])','execute')
    or not has_function_privilege('authenticated','public.send_message_secure(uuid,text,uuid,uuid[])','execute')
  then raise exception 'message RPC grants are incorrect'; end if;
end $$;

create temporary table task11_ids(kind text primary key,id uuid) on commit drop;
grant select,insert,update,delete on task11_ids to authenticated;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$
declare v_dm uuid; v_same uuid; v_group uuid; v_message uuid; v_again uuid; denied boolean:=false;
begin
  v_dm:=public.create_conversation_secure(array['b1000000-0000-0000-0000-000000000002'::uuid],null);
  v_same:=public.create_conversation_secure(array[
    'b1000000-0000-0000-0000-000000000002'::uuid,
    'b1000000-0000-0000-0000-000000000001'::uuid
  ],null);
  if v_dm<>v_same then raise exception 'canonical DM was duplicated'; end if;
  v_group:=public.create_conversation_secure(array[
    'b1000000-0000-0000-0000-000000000002'::uuid,
    'b1000000-0000-0000-0000-000000000003'::uuid
  ],'Secure group');
  insert into task11_ids values('dm',v_dm),('group',v_group);
  begin
    insert into public.conversation_members(conversation_id,user_id) values(v_dm,'b1000000-0000-0000-0000-000000000004');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'arbitrary membership insert succeeded'; end if;
  v_message:=public.send_message_secure(v_dm,'first message','b1111111-1111-1111-1111-111111111111','{}');
  v_again:=public.send_message_secure(v_dm,'first message','b1111111-1111-1111-1111-111111111111','{}');
  if v_message<>v_again then raise exception 'client message id is not idempotent'; end if;
  insert into task11_ids values('message',v_message);
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000004';
do $$ begin
  if (select count(*) from public.messages where conversation_id=(select id from task11_ids where kind='dm'))<>0
    or (select count(*) from public.list_messages_secure((select id from task11_ids where kind='dm'),null,null,20))<>0
  then raise exception 'outsider read conversation messages'; end if;
end $$;

reset role;
-- Seed two completed immutable uploads as the service-side lifecycle would.
insert into public.media_uploads(id,owner_id,object_key,staging_key,original_filename,content_type,media_type,
  declared_size,validated_size,status,expires_at) values
('b1222222-2222-2222-2222-222222222221','b1000000-0000-0000-0000-000000000001',
 'originals/b1000000-0000-0000-0000-000000000001/published/one.jpg',null,'one.jpg','image/jpeg','image',10,10,'uploaded',now()+interval '1 hour'),
('b1222222-2222-2222-2222-222222222222','b1000000-0000-0000-0000-000000000002',
 'originals/b1000000-0000-0000-0000-000000000002/published/two.jpg',null,'two.jpg','image/jpeg','image',10,10,'uploaded',now()+interval '1 hour');

set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$ declare denied boolean:=false; v_media_message uuid;
begin
  v_media_message:=public.send_message_secure((select id from task11_ids where kind='dm'),'with media',
    'b1333333-3333-3333-3333-333333333333',array['b1222222-2222-2222-2222-222222222221'::uuid]);
  insert into task11_ids values('media_message',v_media_message);
  begin
    perform public.send_message_secure((select id from task11_ids where kind='dm'),'double claim',
      'b1333333-3333-3333-3333-333333333334',array['b1222222-2222-2222-2222-222222222221'::uuid]);
  exception when others then denied:=true; end;
  if not denied then raise exception 'upload was double claimed'; end if;
  denied:=false;
  begin
    perform public.send_message_secure((select id from task11_ids where kind='dm'),'cross owner',
      'b1333333-3333-3333-3333-333333333335',array['b1222222-2222-2222-2222-222222222222'::uuid]);
  exception when others then denied:=true; end;
  if not denied then raise exception 'cross-owner upload was claimed'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000002';
do $$ declare v_before timestamptz; v_before_id uuid; v_count bigint; v_expected bigint;
begin
  select message_count into v_count from public.unread_counts_secure();
  if v_count<>2 then raise exception 'message unread count is incorrect: %',v_count; end if;
  perform public.send_message_secure((select id from task11_ids where kind='dm'),'reply',
    'b1444444-4444-4444-4444-444444444444','{}');
  select created_at,id into v_before,v_before_id from public.messages
   where conversation_id=(select id from task11_ids where kind='dm') order by created_at desc,id desc limit 1;
  select count(*) into v_expected from public.messages
   where conversation_id=(select id from task11_ids where kind='dm') and (created_at,id)<(v_before,v_before_id);
  if (select count(*) from public.list_messages_secure((select id from task11_ids where kind='dm'),v_before,v_before_id,100))<>v_expected
  then raise exception 'message cursor pagination is incorrect'; end if;
  if not public.mark_conversation_read_secure((select id from task11_ids where kind='dm'),v_before,v_before_id) then
    raise exception 'conversation read update failed';
  end if;
  select message_count into v_count from public.unread_counts_secure();
  if v_count<>0 then raise exception 'conversation read state did not clear unread count'; end if;
end $$;

reset role;
-- Equal timestamps are ordered by message id, not accidentally consumed together.
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$ begin
  insert into task11_ids values
    ('tie_one',public.send_message_secure((select id from task11_ids where kind='dm'),'tie one','b1666666-6666-6666-6666-666666666661','{}')),
    ('tie_two',public.send_message_secure((select id from task11_ids where kind='dm'),'tie two','b1666666-6666-6666-6666-666666666662','{}'));
end $$;
reset role;
update public.messages set created_at='2030-01-01 00:00:00+00'
 where id in ((select id from task11_ids where kind='tie_one'),(select id from task11_ids where kind='tie_two'));
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000002';
do $$ declare v_lower uuid; v_higher uuid; v_count bigint;
begin
  select id into v_lower from public.messages
   where id in ((select id from task11_ids where kind='tie_one'),(select id from task11_ids where kind='tie_two'))
   order by id limit 1;
  select id into v_higher from public.messages
   where id in ((select id from task11_ids where kind='tie_one'),(select id from task11_ids where kind='tie_two'))
   order by id desc limit 1;
  if not public.mark_conversation_read_secure((select id from task11_ids where kind='dm'),'2030-01-01 00:00:00+00',v_lower)
  then raise exception 'tie-safe lower cursor rejected'; end if;
  select message_count into v_count from public.unread_counts_secure();
  if v_count<>1 then raise exception 'equal timestamp cursor skipped unseen message: %',v_count; end if;
  if not public.mark_conversation_read_secure((select id from task11_ids where kind='dm'),'2030-01-01 00:00:00+00',v_higher)
  then raise exception 'tie-safe higher cursor rejected'; end if;
  select message_count into v_count from public.unread_counts_secure();
  if v_count<>0 then raise exception 'higher tuple cursor did not clear unread'; end if;
end $$;

reset role;
-- Trigger-created notifications are deduped and cannot be forged by clients.
insert into task11_ids
select 'other_notification',id from public.notifications
 where user_id='b1000000-0000-0000-0000-000000000002' order by created_at desc limit 1;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$ declare denied boolean:=false; v_notification uuid; v_unread bigint;
begin
  begin
    insert into public.notifications(user_id,type) values(auth.uid(),'forged');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'notification forgery succeeded'; end if;
  select id into v_notification from public.list_notifications_secure(null,null,100)
   where type='message' order by created_at desc limit 1;
  if v_notification is null then raise exception 'message notification was not generated'; end if;
  if not public.mark_notification_read_secure(v_notification) then raise exception 'notification read failed'; end if;
  if public.mark_notification_read_secure((select id from task11_ids where kind='other_notification')) then
    raise exception 'user marked another owner notification';
  end if;
  perform public.mark_all_notifications_read_secure();
  select notification_count into v_unread from public.unread_counts_secure();
  if v_unread<>0 then raise exception 'notification unread count did not clear'; end if;
  if exists(select dedupe_key from public.notifications where dedupe_key is not null group by dedupe_key having count(*)>1)
  then raise exception 'notifications were not deduped'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$ declare v_private_post uuid; v_private_event uuid; v_search jsonb;
begin
  insert into public.posts(author_id,caption,audience_kind) values(auth.uid(),'secret discovery term','private')
    returning id into v_private_post;
  v_private_event:=public.create_event_secure('Secret meetup','discovery privacy',now()+interval '1 day',null,null,false);
  v_search:=public.search_authorized('secret',60);
  if jsonb_array_length(v_search->'posts')<>1 or jsonb_array_length(v_search->'events')<>1
  then raise exception 'owner search omitted authorized content'; end if;
  if public.search_authorized('x',60)<>jsonb_build_object('people','[]'::jsonb,'events','[]'::jsonb,'posts','[]'::jsonb)
  then raise exception 'short search query returned results'; end if;
  insert into task11_ids values('private_post',v_private_post),('private_event',v_private_event);
end $$;

reset role;
-- Canonical href output is derived for every supported entity type.
insert into public.notifications(user_id,actor_id,type,entity_type,entity_id,dedupe_key) values
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','friend_accepted','friendship',
 (select id from public.friendships where requester_id='b1000000-0000-0000-0000-000000000001' and addressee_id='b1000000-0000-0000-0000-000000000002'),'test-href-friend'),
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','event_invitation','event',
 (select id from task11_ids where kind='private_event'),'test-href-event'),
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','comment','post',
 (select id from task11_ids where kind='private_post'),'test-href-post'),
('b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','message','conversation',
 (select id from task11_ids where kind='dm'),'test-href-conversation');
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$ begin
  if not exists(select 1 from public.list_notifications_secure(null,null,100)
      where type='friend_accepted' and href='/people/b1000000-0000-0000-0000-000000000002')
  then raise exception 'friend notification href is not canonical'; end if;
  if not exists(select 1 from public.list_notifications_secure(null,null,100)
      where type='event_invitation' and href='/events/'||(select id from task11_ids where kind='private_event')::text)
    or not exists(select 1 from public.list_notifications_secure(null,null,100)
      where type='comment' and href='/post/'||(select id from task11_ids where kind='private_post')::text)
    or not exists(select 1 from public.list_notifications_secure(null,null,100)
      where type='message' and href='/messages/'||(select id from task11_ids where kind='dm')::text)
  then raise exception 'entity notification href is not canonical'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000004';
do $$ begin
  if jsonb_array_length(public.search_authorized('secret',60)->'posts')<>0
    or jsonb_array_length(public.search_authorized('secret',60)->'events')<>0
  then raise exception 'search disclosed private content'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
delete from public.posts where id=(select id from task11_ids where kind='private_post');
select public.delete_event_secure((select id from task11_ids where kind='private_event'));
reset role;
do $$ begin
  if exists(select 1 from public.notifications where dedupe_key in ('test-href-post','test-href-event'))
  then raise exception 'deleted post/event retained stale notifications'; end if;
end $$;

-- A creator profile can disappear while a shared conversation, another
-- participant's message/media, and recipient notification remain valid.
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000003';
do $$ begin
  insert into task11_ids values('lifecycle',public.create_conversation_secure(
    array['b1000000-0000-0000-0000-000000000002'::uuid],null));
  insert into task11_ids values('deleted_sender_message',public.send_message_secure(
    (select id from task11_ids where kind='lifecycle'),'creator message',
    'b1777777-7777-7777-7777-777777777771','{}'));
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000002';
do $$ begin
  insert into task11_ids values('retained_message',public.send_message_secure(
    (select id from task11_ids where kind='lifecycle'),'remaining member media',
    'b1777777-7777-7777-7777-777777777772',
    array['b1222222-2222-2222-2222-222222222222'::uuid]));
end $$;
reset role;
delete from public.profiles where id='b1000000-0000-0000-0000-000000000003';
do $$ begin
  if not exists(select 1 from public.conversations where id=(select id from task11_ids where kind='lifecycle') and created_by is null)
    or not exists(select 1 from public.conversation_members where conversation_id=(select id from task11_ids where kind='lifecycle')
      and user_id='b1000000-0000-0000-0000-000000000002')
    or not exists(select 1 from public.messages where id=(select id from task11_ids where kind='retained_message'))
    or not exists(select 1 from public.message_media where message_id=(select id from task11_ids where kind='retained_message'))
  then raise exception 'creator deletion removed shared conversation content'; end if;
  if exists(select 1 from public.messages where id=(select id from task11_ids where kind='deleted_sender_message'))
  then raise exception 'deleted sender message policy did not cascade sender content'; end if;
  if not exists(select 1 from public.notifications where user_id='b1000000-0000-0000-0000-000000000002'
    and entity_type='conversation' and entity_id=(select id from task11_ids where kind='lifecycle') and actor_id is null)
  then raise exception 'recipient conversation notification was not retained'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000002';
do $$ begin
  if not exists(select 1 from public.list_notifications_secure(null,null,100)
    where entity_id=(select id from task11_ids where kind='lifecycle')
      and href='/messages/'||(select id from task11_ids where kind='lifecycle')::text)
  then raise exception 'retained conversation notification deep link is invalid'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
select public.block_member('b1000000-0000-0000-0000-000000000002');

reset role;
do $$ begin
  if exists(select 1 from public.notifications where dedupe_key='test-href-friend')
  then raise exception 'deleted friendship retained stale notification'; end if;
end $$;
set local role authenticated;
set local "request.jwt.claim.sub"='b1000000-0000-0000-0000-000000000001';
do $$ declare denied boolean:=false;
begin
  if exists(select 1 from public.conversation_members where conversation_id=(select id from task11_ids where kind='dm') and user_id=auth.uid())
  then raise exception 'block did not sever conversation membership'; end if;
  begin
    perform public.send_message_secure((select id from task11_ids where kind='dm'),'blocked send',
      'b1555555-5555-5555-5555-555555555555','{}');
  exception when others then denied:=true; end;
  if not denied then raise exception 'blocked pair could still send'; end if;
  if jsonb_array_length(public.search_authorized('Comm B',60)->'people')<>0
  then raise exception 'search disclosed a blocked profile'; end if;
end $$;

reset role;
-- Removing the final member deletes the conversation and its notifications.
delete from public.profiles where id='b1000000-0000-0000-0000-000000000002';
do $$ begin
  if exists(select 1 from public.conversations where id=(select id from task11_ids where kind='lifecycle'))
    or exists(select 1 from public.notifications where entity_type='conversation'
      and entity_id=(select id from task11_ids where kind='lifecycle'))
  then raise exception 'last-member conversation cleanup failed'; end if;
end $$;

rollback;