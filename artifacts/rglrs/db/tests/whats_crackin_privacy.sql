begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','e1000000-0000-0000-0000-000000000001','authenticated','authenticated','location-owner@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','e1000000-0000-0000-0000-000000000002','authenticated','authenticated','location-friend@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','e1000000-0000-0000-0000-000000000003','authenticated','authenticated','location-stranger@example.test','',now(),'{}','{}',now(),now());
insert into public.friendships(requester_id,addressee_id,status) values
('e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002','accepted');
insert into private.location_discovery_eligibility(user_id,eligible,reviewed_at)
values('e1000000-0000-0000-0000-000000000001',true,now());
insert into public.events(id,owner_id,title) values
('e1100000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002','Location event');
insert into public.event_members(event_id,user_id,role,participation_mode) values
('e1100000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002','owner','participate'),
('e1100000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','member','participate');

set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000001';
select public.start_location_sharing_secure('friends','precise',null,'{}'::uuid[],60,120,'Test place',false);
select public.update_my_location_secure(35.3700,-119.0200,12,now());

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000002';
do $$ begin
 if not exists(select 1 from public.get_whats_crackin_nearby(35.3701,-119.0201,5000) x where x.user_id='e1000000-0000-0000-0000-000000000001' and not x.is_anonymous) then
   raise exception 'authorized friend did not receive precise identity';
 end if;
 if exists(select 1 from public.location_sharing_sessions where owner_id='e1000000-0000-0000-0000-000000000001') then
   raise exception 'session table RLS exposed another user';
 end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000001';
select public.set_person_privacy_override_secure('{"person_id":"e1000000-0000-0000-0000-000000000002","can_view_location":false}'::jsonb);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select 1 from public.get_whats_crackin_nearby(35.3701,-119.0201,5000) x where x.user_id='e1000000-0000-0000-0000-000000000001') then
   raise exception 'person-specific denial leaked through nearby query';
 end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000001';
select public.remove_person_privacy_override_secure('e1000000-0000-0000-0000-000000000002');

do $$ declare v_failed boolean:=false; begin
 begin
   perform public.start_location_sharing_secure('anonymous','approximate',null,'{}'::uuid[],60,120,null,false);
 exception when others then v_failed:=true; end;
 if not v_failed then raise exception 'anonymous sharing skipped public acknowledgement'; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000003';
do $$ declare v_failed boolean:=false; begin
  begin
    perform public.start_location_sharing_secure('anonymous','approximate',null,'{}'::uuid[],60,120,null,true);
  exception when others then
    if position('public location discovery is not enabled' in sqlerrm)=0 then raise; end if;
    v_failed:=true;
  end;
  if not v_failed then raise exception 'unknown-age account was allowed public discovery'; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000001';
select public.start_location_sharing_secure('anonymous','approximate',null,'{}'::uuid[],60,120,null,true);
select public.update_my_location_secure(35.3700,-119.0200,12,now());

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000003';
do $$ declare v_row record; begin
 select * into v_row from public.get_whats_crackin_nearby(35.3701,-119.0201,5000) limit 1;
 if v_row.pin_id is null or not v_row.is_anonymous or v_row.user_id is not null or v_row.display_name is not null
    or v_row.username is not null or v_row.avatar_upload_id is not null then
   raise exception 'anonymous discovery leaked identity';
 end if;
 if abs(v_row.latitude-35.3700)<0.0000001 and abs(v_row.longitude-(-119.0200))<0.0000001 then
   raise exception 'anonymous discovery leaked exact coordinates';
 end if;
 if exists(select 1 from public.get_whats_crackin_nearby(35.3700,-119.0200,100)) then
   raise exception 'approximate discovery radius used the private exact point';
 end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000001';
select public.start_location_sharing_secure(
  'event','precise','e1100000-0000-0000-0000-000000000001','{}'::uuid[],60,120,null,false
);
select public.update_my_location_secure(35.3700,-119.0200,12,now());

reset role;
delete from public.event_members
 where event_id='e1100000-0000-0000-0000-000000000001'
   and user_id='e1000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(
   select 1 from public.get_whats_crackin_nearby(35.3701,-119.0201,5000)
    where user_id='e1000000-0000-0000-0000-000000000001'
 ) then raise exception 'event membership removal did not revoke location visibility'; end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e1000000-0000-0000-0000-000000000001';
select public.stop_location_sharing_secure();
do $$ begin
 if coalesce((public.get_my_location_sharing_secure()->>'active')::boolean,true) then raise exception 'stopped sharing remained active'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from private.current_locations where owner_id='e1000000-0000-0000-0000-000000000001') then
   raise exception 'stopped sharing retained exact coordinates';
 end if;
end $$;
rollback;
