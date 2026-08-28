-- Direct uploads target staging keys only. Published keys are server-promoted and never signed.

alter table public.media_uploads
  add column if not exists staging_key text unique,
  add column if not exists direct_upload_expires_at timestamptz;

alter table public.media_uploads drop constraint if exists media_uploads_status_check;
alter table public.media_uploads add constraint media_uploads_status_check
  check(status in ('pending','promoting','uploaded','claimed','failed','deleted'));

drop function if exists public.reserve_media_upload(uuid,uuid,text,text,text,text,bigint,timestamptz);
create or replace function public.reserve_media_upload(
  p_id uuid,
  p_owner_id uuid,
  p_object_key text,
  p_staging_key text,
  p_original_filename text,
  p_content_type text,
  p_media_type text,
  p_declared_size bigint,
  p_expires_at timestamptz,
  p_direct_upload_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_active integer;
  v_daily bigint;
begin
  if p_owner_id is null
     or p_object_key not like 'originals/'||p_owner_id::text||'/published/%'
     or p_staging_key not like 'originals/'||p_owner_id::text||'/drafts/%'
     or p_media_type not in ('image','video')
     or p_content_type not in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')
     or p_declared_size<1
     or (p_media_type='image' and p_declared_size>15728640)
     or (p_media_type='video' and p_declared_size>104857600)
     or p_expires_at<=now()
     or p_direct_upload_expires_at<=now()
     or p_direct_upload_expires_at>p_expires_at
  then raise exception 'invalid media reservation'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text,0));
  select count(*) into v_active from public.media_uploads
   where owner_id=p_owner_id and status in ('pending','promoting','uploaded');
  if v_active>=16 then raise exception 'active media quota exceeded'; end if;
  select coalesce(sum(declared_size),0) into v_daily from public.media_uploads
   where owner_id=p_owner_id and created_at>=now()-interval '24 hours' and status<>'deleted';
  if v_daily+p_declared_size>524288000 then raise exception 'daily media quota exceeded'; end if;

  insert into public.media_uploads(
    id,owner_id,object_key,staging_key,original_filename,content_type,media_type,
    declared_size,expires_at,direct_upload_expires_at
  ) values(
    p_id,p_owner_id,p_object_key,p_staging_key,p_original_filename,p_content_type,p_media_type,
    p_declared_size,p_expires_at,p_direct_upload_expires_at
  );
  return p_id;
end $$;
revoke all on function public.reserve_media_upload(uuid,uuid,text,text,text,text,text,bigint,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.reserve_media_upload(uuid,uuid,text,text,text,text,text,bigint,timestamptz,timestamptz)
  to service_role;

create or replace function public.begin_media_promotion(p_id uuid,p_owner_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
begin
  update public.media_uploads
     set status='promoting',updated_at=now()
   where id=p_id and owner_id=p_owner_id and status='pending' and expires_at>now()
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.begin_media_promotion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_media_promotion(uuid,uuid) to service_role;

create or replace function public.complete_media_upload(
  p_id uuid,
  p_owner_id uuid,
  p_validated_size bigint,
  p_width integer,
  p_height integer,
  p_duration_ms integer
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
begin
  update public.media_uploads
     set status='uploaded',
         validated_size=p_validated_size,
         width=p_width,
         height=p_height,
         duration_ms=p_duration_ms,
         expires_at=now()+interval '24 hours',
         updated_at=now()
   where id=p_id
     and owner_id=p_owner_id
     and status='promoting'
     and expires_at>now()
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.complete_media_upload(uuid,uuid,bigint,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.complete_media_upload(uuid,uuid,bigint,integer,integer,integer)
  to service_role;