-- Keep released published media recoverable for 30 days before R2 cleanup.
-- Draft uploads retain their existing expiration and deletion behavior.

create or replace function public.release_deleted_post_upload()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.upload_id is not null then
    update public.media_uploads
       set status='uploaded',
           post_id=null,
           expires_at=now()+interval '30 days',
           updated_at=now()
     where id=old.upload_id and status='claimed';
  end if;
  return old;
end
$$;

-- Upload lifecycle rows and storage keys are server-only. Protected routes use
-- service_role after authorizing against browser-readable relationship rows.
revoke select on public.media_uploads from authenticated;
drop policy if exists "owners read media uploads" on public.media_uploads;

insert into public.rglrs_migrations(version,filename)
values(30,'030_published_media_recovery_hold.sql')
on conflict(version) do update set filename=excluded.filename;