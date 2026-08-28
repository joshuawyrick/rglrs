-- Friend request state, dynamic friends visibility, and authorized feed paging.
-- Fixtures are rolled back so this can run against a shared test project.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-000000000001','authenticated','authenticated','friend-viewer@example.test','',now(),'{}','{"full_name":"Friend Viewer"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-000000000002','authenticated','authenticated','friend-author@example.test','',now(),'{}','{"full_name":"Friend Author"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-0000-0000-000000000003','authenticated','authenticated','friend-outsider@example.test','',now(),'{}','{"full_name":"Friend Outsider"}',now(),now());

insert into public.posts(id,author_id,caption,audience_kind,created_at) values
  ('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','new visible friend post','friends','2024-01-01 00:00:00+00'),
  ('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','older visible friend post','friends','2023-12-31 00:00:00+00'),
  ('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000003','newer inaccessible one','private','2024-01-04 00:00:00+00'),
  ('c2000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000003','newer inaccessible two','private','2024-01-03 00:00:00+00'),
  ('c2000000-0000-0000-0000-000000000005','c1000000-0000-0000-0000-000000000003','newer inaccessible three','private','2024-01-02 00:00:00+00');
insert into public.audience_rules(post_id,rule_type) values
  ('c2000000-0000-0000-0000-000000000001','include_friends'),
  ('c2000000-0000-0000-0000-000000000002','include_friends');

do $$
begin
  if has_function_privilege('anon','public.list_friendships_secure()','execute')
    or has_function_privilege('anon','public.list_feed_page_secure(timestamp with time zone,uuid,integer)','execute')
    or not has_function_privilege('authenticated','public.list_friendships_secure()','execute')
    or not has_function_privilege('authenticated','public.list_feed_page_secure(timestamp with time zone,uuid,integer)','execute')
  then raise exception 'friend-network RPC grants are incorrect'; end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and (
    not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='friendships')
    or not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='blocks')
  ) then raise exception 'friend-network realtime publication is incomplete'; end if;
  if (select relreplident from pg_class where oid='public.friendships'::regclass)<>'f'
    or (select relreplident from pg_class where oid='public.blocks'::regclass)<>'f'
  then raise exception 'friend-network realtime replica identity is incomplete'; end if;
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='feed_invalidations')
  then raise exception 'private feed invalidation publication is incomplete'; end if;
  if has_table_privilege('anon','public.feed_invalidations','select')
    or not has_table_privilege('authenticated','public.feed_invalidations','select')
    or has_table_privilege('authenticated','public.feed_invalidations','insert')
  then raise exception 'private feed invalidation grants are incorrect'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000001';
do $$
declare v_request uuid;
begin
  if exists(select 1 from public.list_feed_page_secure(null,null,1)) then
    raise exception 'unaccepted friend post was visible';
  end if;
  v_request:=public.create_friend_request_secure('c1000000-0000-0000-0000-000000000002');
  if not exists(select 1 from public.list_friendships_secure()
    where friendship_id=v_request and direction='outgoing' and profile_id='c1000000-0000-0000-0000-000000000002') then
    raise exception 'outgoing request or safe profile row missing';
  end if;
  if not exists(select 1 from public.feed_invalidations where user_id=auth.uid() and reason='friendship')
    or exists(select 1 from public.feed_invalidations where user_id<>auth.uid())
  then raise exception 'friendship invalidation was not private to its recipient'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000003';
do $$
begin
  if public.respond_friend_request_secure(
    (select id from public.friendships where requester_id='c1000000-0000-0000-0000-000000000001'),
    'accepted'
  ) then raise exception 'outsider accepted a friend request'; end if;
  if public.remove_friendship_secure(
    (select id from public.friendships where requester_id='c1000000-0000-0000-0000-000000000001')
  ) then raise exception 'outsider removed a friend request'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000002';
do $$
begin
  if not public.respond_friend_request_secure(
    (select id from public.friendships where requester_id='c1000000-0000-0000-0000-000000000001'),
    'accepted'
  ) then raise exception 'addressee could not accept request'; end if;
  if not exists(select 1 from public.list_friendships_secure()
    where status='accepted' and direction='friend' and profile_id='c1000000-0000-0000-0000-000000000001') then
    raise exception 'accepted friendship was not listed'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000001';
do $$
declare v_rows integer;
begin
  select count(*) into v_rows from public.list_feed_page_secure(null,null,1);
  if v_rows<>2
    or not exists(select 1 from public.list_feed_page_secure(null,null,1)
      where id='c2000000-0000-0000-0000-000000000001') then
    raise exception 'feed did not authorize before paging or return the extra row';
  end if;
  if not public.remove_friendship_secure(
    (select id from public.friendships where requester_id=auth.uid())
  ) then raise exception 'participant could not remove accepted friendship'; end if;
  if exists(select 1 from public.list_feed_page_secure(null,null,10)) then
    raise exception 'removed friendship retained friends-post access';
  end if;
  perform public.create_friend_request_secure('c1000000-0000-0000-0000-000000000002');
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000002';
do $$
begin
  if not public.respond_friend_request_secure(
    (select id from public.friendships where requester_id='c1000000-0000-0000-0000-000000000001'),
    'declined'
  ) then raise exception 'addressee could not decline request'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000001';
do $$
begin
  if public.respond_friend_request_secure(
    (select id from public.friendships where requester_id=auth.uid()),'accepted'
  ) then raise exception 'requester accepted own declined request'; end if;
  if not public.remove_friendship_secure(
    (select id from public.friendships where requester_id=auth.uid())
  ) then raise exception 'participant could not remove declined request'; end if;
  perform public.create_friend_request_secure('c1000000-0000-0000-0000-000000000002');
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000002';
select public.respond_friend_request_secure(
  (select id from public.friendships where requester_id='c1000000-0000-0000-0000-000000000001'),
  'accepted'
);
reset role;

set local role authenticated;
set local "request.jwt.claim.sub"='c1000000-0000-0000-0000-000000000001';
select public.block_member('c1000000-0000-0000-0000-000000000002');
do $$
begin
  if exists(select 1 from public.list_friendships_secure()
    where profile_id='c1000000-0000-0000-0000-000000000002')
    or exists(select 1 from public.list_feed_page_secure(null,null,10))
  then raise exception 'blocked pair appeared in friendship list or feed'; end if;
  if not exists(select 1 from public.feed_invalidations where user_id=auth.uid() and reason='block')
    or exists(select 1 from public.feed_invalidations where user_id<>auth.uid())
  then raise exception 'block invalidation was not private to its recipient'; end if;
end $$;

reset role;
rollback;