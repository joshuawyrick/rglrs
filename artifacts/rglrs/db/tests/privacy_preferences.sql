begin;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','d1000000-0000-0000-0000-000000000001','authenticated','authenticated','privacy-owner@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','d1000000-0000-0000-0000-000000000002','authenticated','authenticated','privacy-viewer@example.test','',now(),'{}','{}',now(),now());
insert into public.friendships(requester_id,addressee_id,status) values('d1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000002','accepted');
set local role authenticated;
set local "request.jwt.claim.sub"='d1000000-0000-0000-0000-000000000001';
select public.set_privacy_settings_secure(
'{"default_post_audience_kind":"friends","default_event_media_audience":"all_event_members","default_media_downloads":false,"allow_internal_resharing":false,"full_profile_visibility":"everyone","profile_photo_visibility":"friends","connections_visibility":"friends","username_discoverability":"everyone","email_discoverability":"nobody","friend_request_policy":"everyone","message_policy":"friends","event_invite_policy":"friends"}',
'[{"scope":"post","rule_type":"include_friends"}]',
 '[{"person_id":"d1000000-0000-0000-0000-000000000002","can_view_profile":false,"can_view_profile_photo":false,"can_view_connections":false,"can_download_media":false,"can_reshare_internal":false,"hide_posts":true,"hide_event_media":true}]');
do $$ begin
 if public.privacy_allows(auth.uid(),'d1000000-0000-0000-0000-000000000002','full_profile_visibility')
  or public.privacy_allows(auth.uid(),'d1000000-0000-0000-0000-000000000002','hide_posts') then raise exception 'person deny did not win'; end if;
  if public.can_view_profile_photo(auth.uid(),'d1000000-0000-0000-0000-000000000002')
    or public.can_download_media(auth.uid(),'d1000000-0000-0000-0000-000000000002')
    or public.can_view_connections(auth.uid(),'d1000000-0000-0000-0000-000000000002')
    or public.can_reshare_profile_content(auth.uid(),'d1000000-0000-0000-0000-000000000002')
  then raise exception 'person privacy denial did not win'; end if;
 if not exists(select 1 from public.privacy_default_audience_rules where user_id=auth.uid() and scope='post' and rule_type='include_friends') then raise exception 'default audience rule missing'; end if;
 if position('auth.users' in lower(pg_get_functiondef('public.get_privacy_settings_secure()'::regprocedure)))>0 then raise exception 'privacy RPC exposed auth users'; end if;
  if position('if v_audience is null then' in lower(pg_get_functiondef('public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)'::regprocedure)))=0
     or position('default_media_downloads' in lower(pg_get_functiondef('public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)'::regprocedure)))=0
     or position('event_media_exclusions' in lower(pg_get_functiondef('public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)'::regprocedure)))=0
  then raise exception 'post defaults or event exclusion reuse missing'; end if;
end $$;
do $$
declare
  v_circle uuid;
  v_event uuid;
  v_post uuid;
  v_kind text;
  v_rule text;
  v_subject uuid;
  v_settings jsonb;
  v_failed boolean:=false;
begin
  v_circle:=public.create_circle_secure('Privacy defaults',null);
  v_event:=public.create_event_secure('Privacy event','',now()+interval '1 day',null,null,null,false);
  v_settings:=(public.get_privacy_settings_secure()->'settings');

  for v_kind,v_rule,v_subject in
    values
      ('private',null::text,null::uuid),
      ('friends','include_friends',null::uuid),
      ('circles','include_circle',v_circle),
      ('events','include_event',v_event),
      ('people','include_user','d1000000-0000-0000-0000-000000000002'::uuid),
      ('except','exclude_user','d1000000-0000-0000-0000-000000000002'::uuid)
  loop
    perform public.update_privacy_settings_secure(
      jsonb_set(jsonb_set(v_settings,'{default_post_audience_kind}',to_jsonb(v_kind)), '{default_media_downloads}','true')
    );
    perform public.set_privacy_default_audience_rules_secure(
      case when v_rule is null then '[]'::jsonb
           else jsonb_build_array(jsonb_build_object(
             'scope','post','rule_type',v_rule,'subject_id',v_subject
           ))
      end
    );
    v_post:=public.create_post_secure(v_kind,null,null,'[]',null,null,null);
    if not exists(
      select 1 from public.posts p
       where p.id=v_post and p.audience_kind=v_kind and p.allow_downloads
    ) then raise exception 'server default did not resolve %',v_kind; end if;
    if v_rule is not null and not exists(
      select 1 from public.audience_rules r
       where r.post_id=v_post and r.rule_type::text=v_rule
         and r.subject_id is not distinct from v_subject
    ) then raise exception 'server default subject did not resolve %',v_kind; end if;
  end loop;

  -- Explicit audience, subject list and false download choice stay explicit.
  perform public.update_privacy_settings_secure(
    jsonb_set(jsonb_set(v_settings,'{default_post_audience_kind}','"friends"'),'{default_media_downloads}','true')
  );
  perform public.set_privacy_default_audience_rules_secure(
    '[{"scope":"post","rule_type":"include_friends","subject_id":null}]'
  );
  v_post:=public.create_post_secure('explicit','people',
    array['d1000000-0000-0000-0000-000000000002'::uuid],'[]',null,null,false);
  if not exists(select 1 from public.posts where id=v_post and audience_kind='people' and not allow_downloads)
     or not exists(select 1 from public.audience_rules where post_id=v_post and rule_type='include_user'
       and subject_id='d1000000-0000-0000-0000-000000000002')
  then raise exception 'explicit post choices were replaced by defaults'; end if;

  perform public.update_privacy_settings_secure(
    jsonb_set(v_settings,'{default_post_audience_kind}','"circles"')
  );
  perform public.set_privacy_default_audience_rules_secure('[]');
  begin
    perform public.create_post_secure('missing subject',null,null,'[]',null,null,null);
  exception when others then
    v_failed:=true;
  end;
  if not v_failed then raise exception 'required default audience subjects were not enforced'; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='d1000000-0000-0000-0000-000000000002';
do $$ begin
 if exists(select 1 from public.profiles where id='d1000000-0000-0000-0000-000000000001') then raise exception 'profile RLS ignored override'; end if;
end $$;
select public.update_privacy_settings_secure(
  jsonb_set(public.get_privacy_settings_secure()->'settings','{message_policy}','"nobody"')
);
reset role;
set local role authenticated;
set local "request.jwt.claim.sub"='d1000000-0000-0000-0000-000000000001';
do $$
declare v_denied boolean:=false;
begin
  begin
    perform public.create_conversation_secure(
      array['d1000000-0000-0000-0000-000000000002'::uuid],null
    );
  exception when others then
    if sqlerrm like '%does not allow messages%' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'denied recipient allowed direct conversation creation'; end if;
end $$;
reset role;
rollback;