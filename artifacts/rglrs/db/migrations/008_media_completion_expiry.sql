-- Completion cannot revive an expired upload session, including during races.

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
     and status='pending'
     and expires_at>now()
  returning id into v_id;
  return v_id is not null;
end $$;
revoke all on function public.complete_media_upload(uuid,uuid,bigint,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.complete_media_upload(uuid,uuid,bigint,integer,integer,integer)
  to service_role;