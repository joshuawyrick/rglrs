-- Task 10 workflow and RLS boundaries. All fixtures roll back.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000001','authenticated','authenticated','event-owner@example.test','',now(),'{}','{"full_name":"Owner"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000002','authenticated','authenticated','event-admin@example.test','',now(),'{}','{"full_name":"Admin"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000003','authenticated','authenticated','event-member@example.test','',now(),'{}','{"full_name":"Member"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000004','authenticated','authenticated','event-viewer@example.test','',now(),'{}','{"full_name":"Viewer"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000005','authenticated','authenticated','event-unrelated@example.test','',now(),'{}','{"full_name":"Unrelated"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000006','authenticated','authenticated','event-blocked@example.test','',now(),'{}','{"full_name":"Blocked"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000007','authenticated','authenticated','event-upload@example.test','',now(),'{}','{"full_name":"Upload only"}',now(),now()),
('00000000-0000-0000-0000-000000000000','91000000-0000-0000-0000-000000000008','authenticated','authenticated','event-pending-block@example.test','',now(),'{}','{"full_name":"Pending blocked"}',now(),now());
-- This legacy invite-boundary suite predates recipient invite preferences and
-- intentionally exercises non-friend token redemption. Dedicated privacy tests
-- cover the Friends/Nobody/person-override policies.
update public.privacy_settings
   set event_invite_policy='everyone'
 where user_id::text like '91000000-0000-0000-0000-%';

insert into public.friendships(requester_id,addressee_id,status) values
('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','accepted'),
('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000003','accepted'),
('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000004','accepted');
insert into public.blocks(blocker_id,blocked_id)
values('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000006');

do $$ begin
  if has_table_privilege('authenticated','public.invites','select')
     or has_table_privilege('authenticated','public.invites','insert')
     or has_table_privilege('authenticated','public.events','update')
     or has_table_privilege('authenticated','public.friendships','insert')
  then raise exception 'direct workflow table privilege remains'; end if;
  if has_function_privilege('anon','public.redeem_event_invite_secure(text,text)','execute')
     or has_function_privilege('anon','public.decide_event_invite_redemption_secure(uuid,uuid,boolean)','execute')
     or has_function_privilege('anon','public.list_event_invite_requests_secure(uuid)','execute')
  then raise exception 'anonymous invite redemption is enabled'; end if;
  if not has_function_privilege('authenticated','public.decide_event_invite_redemption_secure(uuid,uuid,boolean)','execute')
     or not has_function_privilege('authenticated','public.list_event_invite_requests_secure(uuid)','execute')
  then raise exception 'authenticated approval RPC grant is missing'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000005';
do $$ declare v_request uuid; v_again uuid; denied boolean:=false;
begin
  v_request:=public.create_friend_request_secure('91000000-0000-0000-0000-000000000001');
  v_again:=public.create_friend_request_secure('91000000-0000-0000-0000-000000000001');
  if v_request<>v_again then raise exception 'pending friendship is not idempotent'; end if;
  if public.respond_friend_request_secure(v_request,'accepted') then raise exception 'requester accepted own request'; end if;
  begin
    insert into public.events(owner_id,title) values(auth.uid(),'forged');
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'direct event insert succeeded'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000001';
do $$ declare v_request uuid;
begin
  if public.create_friend_request_secure('91000000-0000-0000-0000-000000000002')
     is distinct from (select id from public.friendships
       where least(requester_id,addressee_id)=least(auth.uid(),'91000000-0000-0000-0000-000000000002'::uuid)
         and greatest(requester_id,addressee_id)=greatest(auth.uid(),'91000000-0000-0000-0000-000000000002'::uuid))
  then raise exception 'accepted friendship is not idempotent'; end if;
  select id into v_request from public.friendships
   where requester_id='91000000-0000-0000-0000-000000000005'
     and addressee_id='91000000-0000-0000-0000-000000000001';
  if not public.respond_friend_request_secure(v_request,'declined') then raise exception 'addressee could not decline'; end if;
end $$;

create temporary table task10_ids(kind text primary key,id uuid) on commit drop;
do $$ declare v_circle uuid; v_event uuid;
begin
  v_circle:=public.create_circle_secure('Trusted','✨');
  perform public.set_circle_members_secure(v_circle,array[
    '91000000-0000-0000-0000-000000000002'::uuid,
    '91000000-0000-0000-0000-000000000003'::uuid
  ]);
  insert into task10_ids values('circle',v_circle);
  begin
    perform public.set_circle_members_secure(v_circle,array['91000000-0000-0000-0000-000000000005'::uuid]);
    raise exception 'non-friend circle member accepted';
  exception when raise_exception then
    if sqlerrm='non-friend circle member accepted' then raise; end if;
  end;
  v_event:=public.create_event_secure('Boundary event','private gallery',now()+interval '1 day',now()+interval '2 days','Studio',true);
  insert into task10_ids values('event',v_event);
  perform public.set_event_member_secure(v_event,'91000000-0000-0000-0000-000000000002','admin',true);
  perform public.set_event_member_secure(v_event,'91000000-0000-0000-0000-000000000003','member',true);
  perform public.set_event_member_secure(v_event,'91000000-0000-0000-0000-000000000004','viewer',true);
  if (select count(*) from public.event_members where event_id=v_event
       and ((role in ('owner','admin','member') and participation_mode='participate')
         or (role='viewer' and participation_mode='view_only')))<>4
  then raise exception 'direct event member participation modes are invalid'; end if;
  if not public.update_event_secure(v_event,'Boundary event updated','private gallery',now()+interval '1 day',now()+interval '2 days','Studio',true)
  then raise exception 'owner update failed'; end if;
end $$;

-- Create gallery content addressed to the event.
reset role;
-- RESET ROLE does not clear the request JWT GUC. Keep the seeded post's actor
-- explicit so the write-rate trigger sees author_id=auth.uid().
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000001';
do $$
declare v_event uuid; v_post uuid;
begin
  select id into v_event from task10_ids where kind='event';
  insert into public.posts(author_id,event_id,caption,audience_kind)
  values('91000000-0000-0000-0000-000000000001',v_event,'event gallery','events') returning id into v_post;
  insert into public.audience_rules(post_id,rule_type,subject_id) values(v_post,'include_event',v_event);
  insert into task10_ids values('post',v_post);
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000002';
do $$ declare v_event uuid; v_pin uuid; v_revoke uuid; v_upload uuid; v_approval uuid; v_decline uuid; v_revoked_pending uuid; v_expired_pending uuid; v_blocked_pending uuid; denied boolean:=false;
begin
  select id into v_event from task10_ids where kind='event';
  -- Admin can invite, but cannot promote another admin or change the owner.
  begin perform public.set_event_member_secure(v_event,'91000000-0000-0000-0000-000000000003','admin',true);
  exception when others then denied:=true; end;
  if not denied then raise exception 'admin promoted an admin'; end if;
  v_pin:=public.create_event_invite_secure(v_event,repeat('a',64),'participate','2468',now()+interval '1 day',2);
  v_revoke:=public.create_event_invite_secure(v_event,repeat('b',64),'participate',null,now()+interval '1 day',2);
  v_upload:=public.create_event_invite_secure(v_event,repeat('f',64),'upload_only',null,now()+interval '1 day',2);
  v_approval:=public.create_event_invite_secure(v_event,repeat('1',64),'approval',null,now()+interval '1 day',2);
  v_decline:=public.create_event_invite_secure(v_event,repeat('2',64),'approval',null,now()+interval '1 day',2);
  v_revoked_pending:=public.create_event_invite_secure(v_event,repeat('3',64),'approval',null,now()+interval '1 day',2);
  v_expired_pending:=public.create_event_invite_secure(v_event,repeat('4',64),'approval',null,now()+interval '1 day',2);
  v_blocked_pending:=public.create_event_invite_secure(v_event,repeat('5',64),'approval',null,now()+interval '1 day',2);
  perform public.revoke_event_invite_secure(v_revoke);
  insert into task10_ids values('pin_invite',v_pin),('revoked_invite',v_revoke),
    ('upload_invite',v_upload),('approval_invite',v_approval),('decline_invite',v_decline);
  insert into task10_ids values('revoked_pending',v_revoked_pending),
    ('expired_pending',v_expired_pending),('blocked_pending',v_blocked_pending);
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000003';
do $$ declare v_event uuid; v_view uuid;
begin
  select id into v_event from task10_ids where kind='event';
  if (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>1
  then raise exception 'event member cannot view gallery post'; end if;
  v_view:=public.create_event_invite_secure(v_event,repeat('c',64),'view_only',null,now()+interval '1 day',3);
  insert into task10_ids values('view_invite',v_view);
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000005';
do $$ declare denied boolean:=false; v_event uuid; i integer; v_result uuid;
begin
  if (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>0
  then raise exception 'unrelated user can view event gallery'; end if;
  for i in 1..5 loop
    v_result:=public.redeem_event_invite_secure(repeat('a',64),'1111');
    if v_result is not null then raise exception 'wrong PIN redeemed invite'; end if;
  end loop;
  v_result:=public.redeem_event_invite_secure(repeat('a',64),'2468');
  if v_result is not null then raise exception 'throttled PIN actor redeemed invite'; end if;
  v_event:=(select id from task10_ids where kind='event');
  perform public.redeem_event_invite_secure(repeat('1',64),null);
  perform public.redeem_event_invite_secure(repeat('3',64),null);
  perform public.redeem_event_invite_secure(repeat('4',64),null);
  if public.redeem_event_invite_secure(repeat('b',64),null) is not null
  then raise exception 'revoked invite redeemed'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000007';
do $$ declare v_event uuid; denied boolean:=false;
begin
  if public.redeem_event_invite_secure(repeat('a',64),'0000') is not null then raise exception 'wrong PIN redeemed for second actor'; end if;
  if public.redeem_event_invite_secure(repeat('a',64),'2468') is null then raise exception 'PIN throttle leaked across actors'; end if;
  perform public.redeem_event_invite_secure(repeat('a',64),'2468');
  v_event:=public.redeem_event_invite_secure(repeat('f',64),null);
  perform public.redeem_event_invite_secure(repeat('2',64),null);
  if not exists(select 1 from public.event_members
    where event_id=v_event and user_id=auth.uid() and role='member' and participation_mode='upload_only')
  then raise exception 'upload-only participation was not persisted'; end if;
  begin perform public.create_post_secure('', 'events',array[v_event], '[]'::jsonb,null,false);
  exception when others then denied:=true; end;
  if not denied then raise exception 'upload-only empty post succeeded'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000008';
do $$ begin
  perform public.redeem_event_invite_secure(repeat('5',64),null);
end $$;

reset role;
update public.invites set expires_at=now()-interval '1 minute'
 where id=(select id from task10_ids where kind='expired_pending');
-- The prior authenticated actor was user 8; RESET ROLE alone leaves that JWT
-- in place. This fixture block is owned by user 1, so match the actor explicitly.
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000001';
insert into public.blocks(blocker_id,blocked_id)
values('91000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000008');
do $$ begin
  if (select attempts from private.invite_pin_attempts
       where actor_id='91000000-0000-0000-0000-000000000005'
         and invite_id=(select id from task10_ids where kind='pin_invite')) is distinct from 5
  then raise exception 'PIN failures were not persisted and bounded'; end if;
  if exists(select 1 from private.invite_pin_attempts
       where actor_id='91000000-0000-0000-0000-000000000007'
         and invite_id=(select id from task10_ids where kind='pin_invite'))
  then raise exception 'successful PIN redemption did not clear attempts'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000001';
select public.revoke_event_invite_secure((select id from task10_ids where kind='revoked_pending'));
do $$ declare v_invite uuid;
begin
  foreach v_invite in array array[
    (select id from task10_ids where kind='revoked_pending'),
    (select id from task10_ids where kind='expired_pending'),
    (select id from task10_ids where kind='blocked_pending')
  ] loop
    if public.decide_event_invite_redemption_secure(
      v_invite,
      case when v_invite=(select id from task10_ids where kind='blocked_pending')
        then '91000000-0000-0000-0000-000000000008'::uuid
        else '91000000-0000-0000-0000-000000000005'::uuid end,
      true
    ) then raise exception 'invalidated pending approval was accepted'; end if;
    if not public.decide_event_invite_redemption_secure(
      v_invite,
      case when v_invite=(select id from task10_ids where kind='blocked_pending')
        then '91000000-0000-0000-0000-000000000008'::uuid
        else '91000000-0000-0000-0000-000000000005'::uuid end,
      false
    ) then raise exception 'invalidated pending approval could not be declined'; end if;
  end loop;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000001';
do $$ declare v_accept uuid; v_decline uuid;
begin
  select id into v_accept from task10_ids where kind='approval_invite';
  select id into v_decline from task10_ids where kind='decline_invite';
  if (select count(*) from public.list_event_invite_requests_secure((select id from task10_ids where kind='event'))
       where status='pending')<>2 then raise exception 'pending invite requests not listed'; end if;
  if not public.decide_event_invite_redemption_secure(v_accept,'91000000-0000-0000-0000-000000000005',true)
     or not public.decide_event_invite_redemption_secure(v_decline,'91000000-0000-0000-0000-000000000007',false)
  then raise exception 'approval decision failed'; end if;
  if public.decide_event_invite_redemption_secure(v_accept,'91000000-0000-0000-0000-000000000005',false)
  then raise exception 'approval request was double-decided'; end if;
  if not exists(select 1 from public.list_event_invite_requests_secure((select id from task10_ids where kind='event'))
    where invite_id=v_accept and status='accepted' and decided_by=auth.uid() and decided_at is not null)
    or not exists(select 1 from public.list_event_invite_requests_secure((select id from task10_ids where kind='event'))
    where invite_id=v_decline and status='declined' and decided_by=auth.uid() and decided_at is not null)
  then raise exception 'approval decision audit is incomplete'; end if;
end $$;

reset role;
do $$
declare v_event uuid;
begin
  select id into v_event from task10_ids where kind='event';
  if (select use_count from public.invites where token_hash=repeat('a',64))<>1
  then raise exception 'idempotent redemption consumed multiple uses'; end if;
  insert into public.invites(event_id,created_by,token_hash,mode,expires_at,max_uses,use_count)
  values(v_event,'91000000-0000-0000-0000-000000000001',repeat('d',64),'participate',now()-interval '1 hour',2,0),
        (v_event,'91000000-0000-0000-0000-000000000001',repeat('e',64),'participate',now()+interval '1 day',1,1);
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000006';
do $$ declare denied boolean:=false;
begin
  if (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>0
  then raise exception 'blocked user can view event gallery'; end if;
  if public.redeem_event_invite_secure(repeat('c',64),null) is not null
  then raise exception 'blocked user redeemed invite'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000004';
do $$ declare denied boolean;
begin
  if (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>1
  then raise exception 'viewer cannot view event gallery'; end if;
  if (select count(*) from public.list_event_invite_requests_secure((select id from task10_ids where kind='event')))<>0
  then raise exception 'viewer listed invite requests'; end if;
  denied:=false; begin perform public.create_post_secure('', 'events',array[(select id from task10_ids where kind='event')], '[]'::jsonb,null,false); exception when others then denied:=true; end;
  if not denied then raise exception 'viewer created event post'; end if;
  if public.redeem_event_invite_secure(repeat('d',64),null) is not null then raise exception 'expired invite redeemed'; end if;
  if public.redeem_event_invite_secure(repeat('e',64),null) is not null then raise exception 'exhausted invite redeemed'; end if;
end $$;

-- Blocking severs shared event membership without ever deleting an owner row.
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000001';
select public.block_member('91000000-0000-0000-0000-000000000003');
do $$ begin
  if exists(select 1 from public.event_members where event_id=(select id from task10_ids where kind='event')
      and user_id='91000000-0000-0000-0000-000000000003')
    or not exists(select 1 from public.event_members where event_id=(select id from task10_ids where kind='event')
      and user_id=auth.uid() and role='owner')
  then raise exception 'owner block did not safely remove event member'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from public.events where id=(select id from task10_ids where kind='event'))<>0
    or (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>0
  then raise exception 'owner block retained member event/post visibility'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000004';
select public.block_member('91000000-0000-0000-0000-000000000001');
do $$ begin
  if exists(select 1 from public.event_members where event_id=(select id from task10_ids where kind='event') and user_id=auth.uid())
    or (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>0
  then raise exception 'member blocking owner retained event exposure'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='91000000-0000-0000-0000-000000000007';
select public.block_member('91000000-0000-0000-0000-000000000002');
do $$ begin
  if exists(select 1 from public.event_members where event_id=(select id from task10_ids where kind='event') and user_id=auth.uid())
    or (select count(*) from public.posts where id=(select id from task10_ids where kind='post'))<>0
  then raise exception 'third-party shared-event blocker did not leave'; end if;
end $$;

reset role;
do $$ begin
  if not exists(select 1 from public.event_members
    where event_id=(select id from task10_ids where kind='event')
      and user_id='91000000-0000-0000-0000-000000000001' and role='owner')
    or not exists(select 1 from public.event_members
    where event_id=(select id from task10_ids where kind='event')
      and user_id='91000000-0000-0000-0000-000000000002')
  then raise exception 'block flow removed owner or uninvolved event member'; end if;
end $$;

rollback;