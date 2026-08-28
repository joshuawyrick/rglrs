alter table public.posts
  add column if not exists location_name text;

alter table public.posts
  drop constraint if exists posts_location_name_check;

alter table public.posts
  add constraint posts_location_name_check
  check (
    location_name is null
    or (
      char_length(btrim(location_name)) between 1 and 160
      and location_name = btrim(location_name)
    )
  );

create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb,
  p_location_name text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid; v_subject uuid; v_item jsonb; v_order integer;
  v_rule public.audience_rule_type; v_upload_id uuid; v_upload public.media_uploads%rowtype;
  v_event_id uuid; v_event_role public.event_role; v_participation_mode text;
  v_location_name text:=nullif(btrim(coalesce(p_location_name,'')),'');
begin
  if auth.uid() is null
     or coalesce(char_length(p_caption),0)>220
     or p_audience not in ('private','friends','circles','events','people','except')
     or coalesce(char_length(v_location_name),0)>160
  then raise exception 'invalid post input'; end if;
  if jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array' or coalesce(jsonb_array_length(p_media),0)>8 then raise exception 'invalid media'; end if;
  if p_audience in ('private','friends') and coalesce(cardinality(p_subject_ids),0)<>0 then raise exception 'invalid audience subjects'; end if;
  if p_audience in ('circles','events','people','except') and coalesce(cardinality(p_subject_ids),0)=0 then raise exception 'invalid audience subjects'; end if;
  if p_audience='events' then
    if cardinality(p_subject_ids)<>1 or not public.can_view_event(p_subject_ids[1],auth.uid()) then raise exception 'invalid event audience'; end if;
    v_event_id:=p_subject_ids[1];
    select role,participation_mode into v_event_role,v_participation_mode
      from public.event_members where event_id=v_event_id and user_id=auth.uid();
    if v_event_role is null or v_event_role='viewer' then raise exception 'event posting permission denied'; end if;
    if v_participation_mode='upload_only' and coalesce(jsonb_array_length(p_media),0)=0 then raise exception 'upload-only posts require media'; end if;
  end if;
  insert into public.posts(author_id,event_id,caption,audience_kind,location_name)
  values(auth.uid(),v_event_id,coalesce(p_caption,''),p_audience,v_location_name) returning id into v_id;
  if p_audience in ('friends','except') then insert into public.audience_rules(post_id,rule_type) values(v_id,'include_friends'); end if;
  foreach v_subject in array coalesce(p_subject_ids,'{}'::uuid[]) loop
    v_rule:=case p_audience when 'people' then 'include_user'::public.audience_rule_type when 'except' then 'exclude_user'::public.audience_rule_type when 'circles' then 'include_circle'::public.audience_rule_type when 'events' then 'include_event'::public.audience_rule_type end;
    if not public.can_set_audience_rule(v_id,v_rule,v_subject,auth.uid()) then raise exception 'invalid audience subject'; end if;
    insert into public.audience_rules(post_id,rule_type,subject_id) values(v_id,v_rule,v_subject);
  end loop;
  for v_item,v_order in select value,(ordinality-1)::integer from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) with ordinality loop
    begin v_upload_id:=(v_item->>'upload_id')::uuid; exception when invalid_text_representation then raise exception 'invalid media'; end;
    select * into v_upload from public.media_uploads where id=v_upload_id and owner_id=auth.uid() and status='uploaded' and expires_at>now() for update;
    if not found then raise exception 'invalid media'; end if;
    insert into public.post_media(post_id,upload_id,object_key,media_type,width,height,duration_ms,sort_order)
    values(v_id,v_upload.id,v_upload.object_key,v_upload.media_type,v_upload.width,v_upload.height,v_upload.duration_ms,v_order);
    update public.media_uploads set status='claimed',post_id=v_id,expires_at=now()+interval '100 years',updated_at=now() where id=v_upload.id;
  end loop;
  return v_id;
end $$;

revoke all on function public.create_post_secure(text,text,uuid[],jsonb,text) from public,anon,authenticated;
grant execute on function public.create_post_secure(text,text,uuid[],jsonb,text) to authenticated;