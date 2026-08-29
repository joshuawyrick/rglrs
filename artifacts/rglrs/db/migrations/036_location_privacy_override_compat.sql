-- Preserve the new can_view_location override through every existing privacy-save path.

create or replace function public.set_privacy_settings_secure(p_settings jsonb,p_default_rules jsonb,p_person_overrides jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v jsonb; v_subject uuid;
begin
 if v_actor is null or jsonb_typeof(p_settings)<>'object' or jsonb_typeof(coalesce(p_default_rules,'[]'))<>'array' or jsonb_typeof(coalesce(p_person_overrides,'[]'))<>'array' or jsonb_array_length(coalesce(p_default_rules,'[]'))>500 or jsonb_array_length(coalesce(p_person_overrides,'[]'))>500 then raise exception 'invalid privacy settings'; end if;
 insert into public.privacy_settings(user_id,default_post_audience_kind,default_event_media_audience,default_media_downloads,allow_internal_resharing,full_profile_visibility,profile_photo_visibility,connections_visibility,username_discoverability,email_discoverability,friend_request_policy,message_policy,event_invite_policy,updated_at)
 values(v_actor,p_settings->>'default_post_audience_kind',p_settings->>'default_event_media_audience',(p_settings->>'default_media_downloads')::boolean,(p_settings->>'allow_internal_resharing')::boolean,p_settings->>'full_profile_visibility',p_settings->>'profile_photo_visibility',p_settings->>'connections_visibility',p_settings->>'username_discoverability',p_settings->>'email_discoverability',p_settings->>'friend_request_policy',p_settings->>'message_policy',p_settings->>'event_invite_policy',now())
 on conflict(user_id) do update set default_post_audience_kind=excluded.default_post_audience_kind,default_event_media_audience=excluded.default_event_media_audience,default_media_downloads=excluded.default_media_downloads,allow_internal_resharing=excluded.allow_internal_resharing,full_profile_visibility=excluded.full_profile_visibility,profile_photo_visibility=excluded.profile_photo_visibility,connections_visibility=excluded.connections_visibility,username_discoverability=excluded.username_discoverability,email_discoverability=excluded.email_discoverability,friend_request_policy=excluded.friend_request_policy,message_policy=excluded.message_policy,event_invite_policy=excluded.event_invite_policy,updated_at=now();
 delete from public.privacy_default_audience_rules where user_id=v_actor;
 for v in select value from jsonb_array_elements(coalesce(p_default_rules,'[]')) loop
  begin v_subject:=nullif(v->>'subject_id','')::uuid; exception when invalid_text_representation then raise exception 'invalid privacy rule'; end;
  if v->>'scope' not in ('post','event_media') or v->>'rule_type' not in ('include_friends','include_circle','include_event','include_user','exclude_user') or ((v->>'rule_type'='include_friends')<>(v_subject is null)) then raise exception 'invalid privacy rule'; end if;
  insert into public.privacy_default_audience_rules(user_id,scope,rule_type,subject_id) values(v_actor,v->>'scope',(v->>'rule_type')::public.audience_rule_type,v_subject);
 end loop;
 delete from public.person_privacy_overrides where owner_id=v_actor;
 for v in select value from jsonb_array_elements(coalesce(p_person_overrides,'[]')) loop
  begin v_subject:=(v->>'person_id')::uuid; exception when invalid_text_representation then raise exception 'invalid person override'; end;
  if v_subject is null or v_subject=v_actor or not exists(select 1 from public.profiles where id=v_subject) then raise exception 'invalid person override'; end if;
  insert into public.person_privacy_overrides(owner_id,person_id,can_view_profile,can_view_profile_photo,can_view_connections,can_find_username,can_find_email,can_send_friend_request,can_message,can_invite_to_events,can_download_media,can_reshare_internal,hide_posts,hide_event_media,can_view_location)
  values(v_actor,v_subject,(v->>'can_view_profile')::boolean,(v->>'can_view_profile_photo')::boolean,(v->>'can_view_connections')::boolean,(v->>'can_find_username')::boolean,(v->>'can_find_email')::boolean,(v->>'can_send_friend_request')::boolean,(v->>'can_message')::boolean,(v->>'can_invite_to_events')::boolean,(v->>'can_download_media')::boolean,(v->>'can_reshare_internal')::boolean,(v->>'hide_posts')::boolean,(v->>'hide_event_media')::boolean,(v->>'can_view_location')::boolean);
 end loop; return true;
end $$;
