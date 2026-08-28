begin;

do $$
declare
  owner_id uuid := '00000000-0000-0000-0000-00000000e331';
  first_upload uuid := '00000000-0000-0000-0000-00000000e332';
  second_upload uuid := '00000000-0000-0000-0000-00000000e333';
  event_id uuid;
begin
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
  values(owner_id,'authenticated','authenticated','event-cover@example.test','',now(),now(),now());

  insert into public.media_uploads(
    id,owner_id,object_key,original_filename,content_type,media_type,
    declared_size,validated_size,width,height,status,expires_at
  ) values
    (first_upload,owner_id,'originals/'||owner_id||'/published/'||first_upload||'/cover.jpg','cover.jpg','image/jpeg','image',1024,1024,800,600,'uploaded',now()+interval '1 day'),
    (second_upload,owner_id,'originals/'||owner_id||'/published/'||second_upload||'/cover.jpg','cover.jpg','image/jpeg','image',1024,1024,800,600,'uploaded',now()+interval '1 day');

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  event_id := public.create_event_secure(
    'Cover event','',now()+interval '1 day',now()+interval '2 days',
    null,null,false,false,'UTC',first_upload
  );

  if not exists(
    select 1 from public.events
     where id=event_id and cover_upload_id=first_upload
       and cover_key='/private-media/event-cover/'||event_id::text
  ) or not exists(
    select 1 from public.media_uploads
     where id=first_upload and status='claimed' and expires_at>now()+interval '99 years'
  ) then raise exception 'event cover was not atomically claimed'; end if;

  if not public.update_event_secure(
    event_id,'Cover event','',now()+interval '1 day',now()+interval '2 days',
    null,null,false,false,'UTC',second_upload
  ) then raise exception 'event cover replacement failed'; end if;

  if not exists(
    select 1 from public.media_uploads
     where id=first_upload and status='uploaded'
       and expires_at>now()+interval '29 days' and expires_at<=now()+interval '30 days'
  ) or not exists(
    select 1 from public.media_uploads where id=second_upload and status='claimed'
  ) then raise exception 'cover replacement did not preserve recovery lifecycle'; end if;

  if not public.update_event_secure(
    event_id,'Cover event','',now()+interval '1 day',now()+interval '2 days',
    null,null,false,true,'UTC',null
  ) then raise exception 'event cover clear failed'; end if;
  if exists(select 1 from public.events where id=event_id and (cover_upload_id is not null or cover_key is not null))
     or not exists(select 1 from public.media_uploads where id=second_upload and status='uploaded' and expires_at>now()+interval '29 days')
  then raise exception 'cover clear did not retain recoverable media'; end if;

  if not public.update_event_secure(
    event_id,'Cover event','',now()+interval '1 day',now()+interval '2 days',
    null,null,false,false,'UTC',first_upload
  ) then raise exception 'recoverable upload could not be reclaimed'; end if;
  if not public.delete_event_secure(event_id) then raise exception 'event delete failed'; end if;
  if not exists(select 1 from public.media_uploads where id=first_upload and status='uploaded' and expires_at>now()+interval '29 days')
  then raise exception 'event deletion did not retain cover for recovery'; end if;
end
$$;

rollback;