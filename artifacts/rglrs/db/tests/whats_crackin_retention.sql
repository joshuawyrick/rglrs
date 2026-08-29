begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','e2000000-0000-0000-0000-000000000001','authenticated','authenticated','retention-owner@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','e2000000-0000-0000-0000-000000000002','authenticated','authenticated','retention-viewer@example.test','',now(),'{}','{}',now(),now());
insert into public.friendships(requester_id,addressee_id,status) values
('e2000000-0000-0000-0000-000000000001','e2000000-0000-0000-0000-000000000002','accepted');

set local role authenticated;
set local "request.jwt.claim.sub"='e2000000-0000-0000-0000-000000000001';
select public.start_location_sharing_secure('friends','precise',null,'{}'::uuid[],60,120,'Private label',false);
select public.update_my_location_secure(35.3700,-119.0200,10,now());
select public.update_privacy_settings_secure(
  jsonb_set(public.get_privacy_settings_secure()->'settings','{username_discoverability}','"nobody"')
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='e2000000-0000-0000-0000-000000000002';
do $$ declare v_row record; begin
 select * into v_row from public.get_whats_crackin_nearby(35.3701,-119.0201,5000) where user_id='e2000000-0000-0000-0000-000000000001' limit 1;
 if v_row.user_id is null then raise exception 'friend location unexpectedly missing'; end if;
 if v_row.username is not null then raise exception 'nearby response ignored username discoverability'; end if;
end $$;

reset role;
update private.current_locations set captured_at=now()-interval '9 hours' where owner_id='e2000000-0000-0000-0000-000000000001';
select public.prune_expired_locations_secure();
do $$ begin
 if exists(select 1 from private.current_locations where owner_id='e2000000-0000-0000-0000-000000000001') then
   raise exception 'expired exact location was retained';
 end if;
end $$;
rollback;
