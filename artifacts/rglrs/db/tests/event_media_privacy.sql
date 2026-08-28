-- Contributor-owned event exclusions, event unsharing, and download flags.
begin;

insert into auth.users (
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000001','authenticated','authenticated','event-owner@example.test','',now(),'{}','{"full_name":"Event Owner"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000002','authenticated','authenticated','event-uploader@example.test','',now(),'{}','{"full_name":"Event Uploader"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000003','authenticated','authenticated','event-excluded@example.test','',now(),'{}','{"full_name":"Excluded Member"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a1000000-0000-0000-0000-000000000004','authenticated','authenticated','event-other@example.test','',now(),'{}','{"full_name":"Other Contributor"}',now(),now());

insert into public.events(id,owner_id,title)
values('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Private media event');
insert into public.event_members(event_id,user_id,role,participation_mode) values
  ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','owner','participate'),
  ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','member','participate'),
  ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000003','member','participate'),
  ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000004','member','participate');

insert into public.posts(id,author_id,event_id,caption,audience_kind) values
  ('a3000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','Uploader old media','events'),
  ('a3000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000001','Other contributor media','events');
insert into public.posts(id,author_id,caption,audience_kind)
values('a3000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-000000000003','Viewer private post','private');
insert into public.audience_rules(post_id,rule_type,subject_id) values
  ('a3000000-0000-0000-0000-000000000001','include_event','a2000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002','include_event','a2000000-0000-0000-0000-000000000001');
insert into public.post_media(id,post_id,object_key,media_type) values
  ('a4000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','originals/a1000000-0000-0000-0000-000000000002/event.jpg','image'),
  ('a4000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000002','originals/a1000000-0000-0000-0000-000000000004/event.jpg','image');

set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000002';
select public.set_event_media_sharing_secure(
  'a2000000-0000-0000-0000-000000000001',
  array['a1000000-0000-0000-0000-000000000003'::uuid]
);
do $$ begin
  if (select count(*) from public.event_media_exclusions
       where event_id='a2000000-0000-0000-0000-000000000001'
         and uploader_id=auth.uid()
         and excluded_user_id='a1000000-0000-0000-0000-000000000003')<>1
  then raise exception 'contributor sharing choice was not persisted'; end if;
end $$;

reset role;
insert into public.posts(id,author_id,event_id,caption,audience_kind) values
  ('a3000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000001','Uploader future media','events');
insert into public.audience_rules(post_id,rule_type,subject_id)
values('a3000000-0000-0000-0000-000000000003','include_event','a2000000-0000-0000-0000-000000000001');
insert into public.post_media(id,post_id,object_key,media_type)
values('a4000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000003','originals/a1000000-0000-0000-0000-000000000002/future.jpg','image');

set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000003';
do $$ begin
  if (select count(*) from public.posts where id in (
    'a3000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000003'
  ))<>0 then raise exception 'excluded viewer saw contributor media'; end if;
  if (select count(*) from public.post_media where id in (
    'a4000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000003'
  ))<>0 then raise exception 'excluded viewer reached protected contributor media'; end if;
  if (select count(*) from public.posts where id='a3000000-0000-0000-0000-000000000002')<>1
  then raise exception 'contributor exclusion hid another contributor media'; end if;
  if (select count(*) from public.event_members where event_id='a2000000-0000-0000-0000-000000000001' and user_id=auth.uid())<>1
  then raise exception 'contributor exclusion removed event membership'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000001';
do $$ declare denied boolean:=false;
begin
  begin
    perform public.unshare_event_post_secure('a3000000-0000-0000-0000-000000000001');
  exception when others then denied:=true; end;
  if not denied then raise exception 'event owner unshared another contributor post'; end if;
  denied:=false;
  begin
    delete from public.event_media_exclusions
     where uploader_id='a1000000-0000-0000-0000-000000000002';
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'event owner directly rewrote another contributor sharing'; end if;
end $$;

reset role;
update public.event_members
   set role='viewer',participation_mode='view_only'
 where event_id='a2000000-0000-0000-0000-000000000001'
   and user_id='a1000000-0000-0000-0000-000000000003';
set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000003';
do $$ declare post_denied boolean:=false; audience_denied boolean:=false; legacy_rpc_denied boolean:=false; legacy_four_arg_denied boolean:=false;
begin
  begin
    update public.posts
       set event_id='a2000000-0000-0000-0000-000000000001',audience_kind='events'
     where id='a3000000-0000-0000-0000-000000000004';
  exception when insufficient_privilege then post_denied:=true; end;
  begin
    insert into public.audience_rules(post_id,rule_type,subject_id)
    values('a3000000-0000-0000-0000-000000000004','include_event','a2000000-0000-0000-0000-000000000001');
  exception when insufficient_privilege then audience_denied:=true; end;
  begin
    perform public.create_post_secure(
      'view-only bypass attempt','events',
      array['a2000000-0000-0000-0000-000000000001'::uuid],
      '[]'::jsonb,null
    );
  exception when insufficient_privilege then legacy_rpc_denied:=true; end;
  begin
    perform public.create_post_secure(
      'view-only four-argument bypass attempt','events',
      array['a2000000-0000-0000-0000-000000000001'::uuid],
      '[]'::jsonb
    );
  exception when insufficient_privilege then legacy_four_arg_denied:=true; end;
  if not post_denied or not audience_denied or not legacy_rpc_denied or not legacy_four_arg_denied
  then raise exception 'view-only member bypassed RPC-only event posting'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000002';
do $$ begin
  if (select allow_downloads from public.posts where id='a3000000-0000-0000-0000-000000000001')
  then raise exception 'downloads did not default off'; end if;
  if not public.set_post_downloads_secure('a3000000-0000-0000-0000-000000000001',true)
  then raise exception 'owner could not enable downloads'; end if;
  if not (select allow_downloads from public.posts where id='a3000000-0000-0000-0000-000000000001')
  then raise exception 'download setting was not persisted'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000004';
do $$ declare denied boolean:=false;
begin
  begin
    perform public.set_post_downloads_secure('a3000000-0000-0000-0000-000000000001',false);
  exception when others then denied:=true; end;
  if not denied then raise exception 'non-owner changed download permission'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000002';
select public.unshare_event_post_secure('a3000000-0000-0000-0000-000000000001');
do $$ begin
  if not exists(
    select 1 from public.posts
     where id='a3000000-0000-0000-0000-000000000001'
       and author_id=auth.uid() and event_id is null and audience_kind='private'
  ) then raise exception 'unshared post was deleted or remained attached to the event'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='a1000000-0000-0000-0000-000000000001';
do $$ begin
  if (select count(*) from public.posts where id='a3000000-0000-0000-0000-000000000001')<>0
  then raise exception 'event owner retained access after contributor unshared post'; end if;
  if (select count(*) from public.posts where id='a3000000-0000-0000-0000-000000000002')<>1
  then raise exception 'unsharing one contributor changed another contributor post'; end if;
end $$;

reset role;
rollback;