begin;

do $$
declare
  alice uuid := '00000000-0000-0000-0000-000000009101';
  bob uuid := '00000000-0000-0000-0000-000000009102';
  upload_one uuid := '00000000-0000-0000-0000-000000009201';
  expired_upload uuid := '00000000-0000-0000-0000-000000009202';
  expired_pending uuid := '00000000-0000-0000-0000-000000009203';
  draft_upload uuid := '00000000-0000-0000-0000-000000009204';
  post_one uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values
    (alice,'authenticated','authenticated','media-alice@example.test','',now(),now(),now()),
    (bob,'authenticated','authenticated','media-bob@example.test','',now(),now(),now());

  insert into public.media_uploads(
    id,owner_id,object_key,original_filename,content_type,media_type,
    declared_size,validated_size,width,height,status,expires_at
  ) values
    (upload_one,alice,'originals/'||alice||'/'||upload_one||'/photo.jpg','photo.jpg','image/jpeg','image',1024,1024,800,600,'uploaded',now()+interval '1 hour'),
    (expired_upload,alice,'originals/'||alice||'/'||expired_upload||'/old.jpg','old.jpg','image/jpeg','image',1024,1024,800,600,'uploaded',now()-interval '1 minute'),
    (expired_pending,alice,'originals/'||alice||'/'||expired_pending||'/pending.jpg','pending.jpg','image/jpeg','image',1024,null,null,null,'pending',now()-interval '1 minute'),
    (draft_upload,alice,'originals/'||alice||'/'||draft_upload||'/draft.jpg','draft.jpg','image/jpeg','image',1024,null,null,null,'pending',now()-interval '1 minute');

  if public.begin_media_promotion(expired_pending,alice) then
    raise exception 'expired pending upload was revived by completion';
  end if;
  if not exists(select 1 from public.media_uploads where id=expired_pending and status='pending' and validated_size is null and expires_at<=now()) then
    raise exception 'expired pending upload changed during rejected completion';
  end if;

  perform set_config('request.jwt.claim.sub',bob::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.create_post_secure('stolen','private','{}'::uuid[],jsonb_build_array(jsonb_build_object('upload_id',upload_one,'sort_order',0)),null,false);
    raise exception 'cross-user upload claim unexpectedly succeeded';
  exception when others then
    if sqlerrm='cross-user upload claim unexpectedly succeeded' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',alice::text,true);
  begin
    perform public.create_post_secure('expired','private','{}'::uuid[],jsonb_build_array(jsonb_build_object('upload_id',expired_upload,'sort_order',0)),null,false);
    raise exception 'expired upload claim unexpectedly succeeded';
  exception when others then
    if sqlerrm='expired upload claim unexpectedly succeeded' then raise; end if;
  end;

  post_one := public.create_post_secure('valid','private','{}'::uuid[],jsonb_build_array(jsonb_build_object('upload_id',upload_one,'sort_order',0)),null,false);
  if not exists(select 1 from public.media_uploads where id=upload_one and status='claimed' and post_id=post_one) then
    raise exception 'upload was not atomically claimed';
  end if;
  if not exists(select 1 from public.post_media where post_id=post_one and upload_id=upload_one and media_type='image') then
    raise exception 'post media did not use validated upload metadata';
  end if;
  if exists(select 1 from public.post_media where post_id=post_one and sort_order<>0) then
    raise exception 'server did not derive deterministic media order';
  end if;

  begin
    perform public.create_post_secure('reuse','private','{}'::uuid[],jsonb_build_array(jsonb_build_object('upload_id',upload_one,'sort_order',0)),null,false);
    raise exception 'upload reuse unexpectedly succeeded';
  exception when others then
    if sqlerrm='upload reuse unexpectedly succeeded' then raise; end if;
  end;

  delete from public.posts where id=post_one;
  if exists(select 1 from public.posts where id=post_one)
     or exists(select 1 from public.post_media where post_id=post_one or upload_id=upload_one)
  then
    raise exception 'deleted post media remained user-visible';
  end if;
  if not exists(
    select 1
      from public.media_uploads
     where id=upload_one
       and status='uploaded'
       and expires_at>now()+interval '29 days'
       and expires_at<=now()+interval '30 days'
  ) then
    raise exception 'deleted published media did not receive a 30-day hold';
  end if;
  if exists(
    select 1
      from public.media_uploads
     where id=upload_one
       and status in ('pending','promoting','uploaded','failed')
       and expires_at<now()
  ) then
    raise exception 'deleted published media became cleanup-eligible early';
  end if;

  update public.media_uploads
     set expires_at=now()+interval '30 days'-interval '1 second'
   where id=upload_one;
  if exists(
    select 1
      from public.media_uploads
     where id=upload_one
       and status in ('pending','promoting','uploaded','failed')
       and expires_at<now()
  ) then
    raise exception 'published media became cleanup-eligible before 30 days';
  end if;

  update public.media_uploads
     set expires_at=now()-interval '1 second'
   where id=upload_one;
  if not exists(
    select 1
      from public.media_uploads
     where id=upload_one
       and status in ('pending','promoting','uploaded','failed')
       and expires_at<now()
  ) then
    raise exception 'published media was not cleanup-eligible after 30 days';
  end if;

  if not exists(
    select 1
      from public.media_uploads
     where id=draft_upload
       and status='pending'
       and expires_at<now()
  ) then
    raise exception 'unused draft no longer follows existing cleanup behavior';
  end if;
end $$;

rollback;