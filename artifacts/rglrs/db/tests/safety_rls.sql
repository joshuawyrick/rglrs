-- Safety regression checks; runs after migration 005 and rolls back.
begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000001','authenticated','authenticated','safe-a@example.test','',now(),'{}','{"full_name":"Safe A"}',now(),now()),
('00000000-0000-0000-0000-000000000000','81000000-0000-0000-0000-000000000002','authenticated','authenticated','safe-b@example.test','',now(),'{}','{"full_name":"Safe B"}',now(),now());
insert into public.friendships(requester_id,addressee_id,status) values('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002','accepted');
insert into public.circles(id,owner_id,name) values('83000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','Safety circle');
insert into public.circle_members(circle_id,user_id) values('83000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002');
insert into public.posts(id,author_id,caption,audience_kind) values('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','safety post','friends');
insert into public.posts(id,author_id,caption,audience_kind) values('82000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000002','peer post','friends');
insert into public.audience_rules(post_id,rule_type) values('82000000-0000-0000-0000-000000000001','include_friends');
insert into public.post_media(post_id,object_key,media_type) values('82000000-0000-0000-0000-000000000001','originals/81000000-0000-0000-0000-000000000001/a.jpg','image');
do $$ begin
 if has_function_privilege('anon','public.create_post_secure(text,text,uuid[],jsonb)','execute') then raise exception 'anonymous role can execute secure post RPC'; end if;
 if has_function_privilege('anon','public.report_member(uuid,text,text)','execute') then raise exception 'anonymous role can execute report RPC'; end if;
 if has_table_privilege('authenticated','public.reports','insert') then raise exception 'authenticated role can bypass report RPC'; end if;
end $$;
set local role authenticated; set local "request.jwt.claim.sub"='81000000-0000-0000-0000-000000000001';
do $$ declare created_post uuid; begin
 if (select count(*) from public.circles where id='83000000-0000-0000-0000-000000000001')<>1
   or (select count(*) from public.circle_members where circle_id='83000000-0000-0000-0000-000000000001')<>1
 then raise exception 'circle owner cannot read circle membership'; end if;
 created_post := public.create_post_secure('except test','except',array['81000000-0000-0000-0000-000000000002'::uuid],'[]',null,false);
 if not exists(select 1 from public.audience_rules where post_id=created_post and rule_type='include_friends')
   or not exists(select 1 from public.audience_rules where post_id=created_post and rule_type='exclude_user' and subject_id='81000000-0000-0000-0000-000000000002')
 then raise exception 'everyone-except rules are incomplete'; end if;
end $$;
select public.block_member('81000000-0000-0000-0000-000000000002');
do $$ declare denied boolean:=false; limited boolean:=false; i integer; begin
 if not public.is_blocked('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002') then raise exception 'block is not symmetric'; end if;
 if exists(select 1 from public.friendships where requester_id in ('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002') and addressee_id in ('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002')) then raise exception 'block did not sever friendship'; end if;
 if (select count(*) from public.eligible_audience_profiles())<>0 then raise exception 'blocked friend eligible'; end if;
 begin perform public.create_post_secure('x','people',array['81000000-0000-0000-0000-000000000002'::uuid],'[]',null,false); exception when others then denied:=true; end;
 if not denied then raise exception 'blocked audience accepted'; end if; end $$;
reset role; set local role authenticated; set local "request.jwt.claim.sub"='81000000-0000-0000-0000-000000000002';
do $$ declare denied boolean:=false; begin
 begin
  insert into public.post_media(post_id,object_key,media_type) values('82000000-0000-0000-0000-000000000002','originals/81000000-0000-0000-0000-000000000001/a.jpg','image');
  raise exception 'media key relay was accepted';
 exception when insufficient_privilege or check_violation then null; end;
 if (select count(*) from public.profiles where id='81000000-0000-0000-0000-000000000001')<>0 or (select count(*) from public.posts where id='82000000-0000-0000-0000-000000000001')<>0 or (select count(*) from public.post_media where post_id='82000000-0000-0000-0000-000000000001')<>0 then raise exception 'blocked content leaked'; end if;
 begin perform public.report_member('81000000-0000-0000-0000-000000000001','harassment','Repeated abusive messages'); exception when others then denied:=true; end;
 if denied then raise exception 'report RPC unexpectedly failed'; end if;
 denied:=false;
 begin perform public.report_member('81000000-0000-0000-0000-000000000002','spam','Attempted self report'); exception when others then denied:=true; end;
 if not denied then raise exception 'self report was accepted'; end if;
 if (select count(*) from public.reports where reporter_id='81000000-0000-0000-0000-000000000001')<>0 then raise exception 'reports leaked'; end if; end $$;
do $$ declare limited boolean:=false; i integer; begin
  for i in 1..19 loop perform public.report_member('81000000-0000-0000-0000-000000000001','spam','Repeated spam report'); end loop;
  begin perform public.report_member('81000000-0000-0000-0000-000000000001','spam','Repeated spam report'); exception when others then limited:=position('RATE_LIMITED' in sqlerrm)>0; end;
  if not limited then raise exception 'report write rate limit was not enforced'; end if;
end $$;
reset role;
delete from auth.users where id in ('81000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000002');
do $$ begin
 if not exists(
   select 1 from public.reports
    where reporter_id is null
      and target_id is null
      and target_snapshot_id='81000000-0000-0000-0000-000000000001'
      and category='harassment'
 ) then raise exception 'moderation report was not retained after account deletion'; end if;
end $$;
rollback;