-- Atomic media quota reservations, deterministic ordering, and controlled deletion.

alter table public.media_uploads
  add column if not exists cleanup_attempts integer not null default 0,
  add column if not exists cleanup_last_error text;

create or replace function public.reserve_media_upload(
  p_id uuid,
  p_owner_id uuid,
  p_object_key text,
  p_original_filename text,
  p_content_type text,
  p_media_type text,
  p_declared_size bigint,
  p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_active integer;
  v_daily bigint;
begin
  if p_owner_id is null
     or p_media_type not in ('image','video')
     or p_content_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')
     or p_declared_size<1
     or (p_media_type='image' and p_declared_size>15728640)
     or (p_media_type='video' and p_declared_size>104857600)
     or p_expires_at<=now()
  then raise exception 'invalid media reservation'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select count(*) into v_active from public.media_uploads
   where owner_id=p_owner_id and status in ('pending','uploaded');
  if v_active>=16 then raise exception 'active media quota exceeded'; end if;
  select coalesce(sum(declared_size),0) into v_daily from public.media_uploads
   where owner_id=p_owner_id and created_at>=now()-interval '24 hours' and status<>'deleted';
  if v_daily+p_declared_size>524288000 then raise exception 'daily media quota exceeded'; end if;

  insert into public.media_uploads(
    id,owner_id,object_key,original_filename,content_type,media_type,
    declared_size,expires_at
  ) values(
    p_id,p_owner_id,p_object_key,p_original_filename,p_content_type,p_media_type,
    p_declared_size,p_expires_at
  );
  return p_id;
end $$;
revoke all on function public.reserve_media_upload(uuid,uuid,text,text,text,text,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_media_upload(uuid,uuid,text,text,text,text,bigint,timestamptz) to service_role;

drop policy if exists "authors delete post media" on public.post_media;
drop policy if exists "authors manage post media" on public.post_media;
create unique index if not exists post_media_post_sort_unique on public.post_media(post_id,sort_order);

create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_subject uuid;
  v_item jsonb;
  v_order integer;
  v_rule public.audience_rule_type;
  v_upload_id uuid;
  v_upload public.media_uploads%rowtype;
begin
  if auth.uid() is null or coalesce(char_length(p_caption),0)>220 or p_audience not in ('private','friends','circles','events','people','except') then raise exception 'invalid post input'; end if;
  if jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array' or coalesce(jsonb_array_length(p_media),0)>8 then raise exception 'invalid media'; end if;
  if p_audience in ('private','friends') and coalesce(cardinality(p_subject_ids),0)<>0 then raise exception 'invalid audience subjects'; end if;
  if p_audience in ('circles','events','people','except') and coalesce(cardinality(p_subject_ids),0)=0 then raise exception 'invalid audience subjects'; end if;

  insert into public.posts(author_id,caption,audience_kind)
  values(auth.uid(),coalesce(p_caption,''),p_audience)
  returning id into v_id;

  if p_audience in ('friends','except') then
    insert into public.audience_rules(post_id,rule_type) values(v_id,'include_friends');
  end if;
  foreach v_subject in array coalesce(p_subject_ids,'{}'::uuid[]) loop
    v_rule := case p_audience
      when 'people' then 'include_user'::public.audience_rule_type
      when 'except' then 'exclude_user'::public.audience_rule_type
      when 'circles' then 'include_circle'::public.audience_rule_type
      when 'events' then 'include_event'::public.audience_rule_type
    end;
    if not public.can_set_audience_rule(v_id,v_rule,v_subject,auth.uid()) then raise exception 'invalid audience subject'; end if;
    insert into public.audience_rules(post_id,rule_type,subject_id) values(v_id,v_rule,v_subject);
  end loop;

  for v_item,v_order in
    select value,(ordinality-1)::integer
      from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) with ordinality
  loop
    begin
      v_upload_id := (v_item->>'upload_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid media';
    end;
    select * into v_upload
      from public.media_uploads
     where id=v_upload_id and owner_id=auth.uid() and status='uploaded' and expires_at>now()
     for update;
    if not found then raise exception 'invalid media'; end if;
    insert into public.post_media(
      post_id,upload_id,object_key,media_type,width,height,duration_ms,sort_order
    ) values(
      v_id,v_upload.id,v_upload.object_key,v_upload.media_type,
      v_upload.width,v_upload.height,v_upload.duration_ms,v_order
    );
    update public.media_uploads
       set status='claimed',post_id=v_id,expires_at=now()+interval '100 years',updated_at=now()
     where id=v_upload.id;
  end loop;
  return v_id;
end $$;
revoke all on function public.create_post_secure(text,text,uuid[],jsonb) from public,anon;
grant execute on function public.create_post_secure(text,text,uuid[],jsonb) to authenticated;