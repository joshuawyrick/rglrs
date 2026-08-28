-- Serialize scheduled private-media cleanup across autoscaled instances.

create table if not exists private.operation_leases (
  operation text primary key,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);
revoke all on private.operation_leases from public,anon,authenticated;
grant all on private.operation_leases to service_role;

create or replace function public.claim_private_media_cleanup()
returns boolean language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_claimed boolean:=false;
begin
  insert into private.operation_leases(operation,lease_until)
  values('private_media_cleanup',now()+interval '5 minutes')
  on conflict(operation) do update
    set lease_until=excluded.lease_until,updated_at=now()
    where private.operation_leases.lease_until<=now();
  get diagnostics v_claimed=row_count;
  return v_claimed;
end
$$;

create or replace function public.release_private_media_cleanup()
returns void language sql security definer set search_path=public,private,pg_temp as $$
  update private.operation_leases
     set lease_until=now(),updated_at=now()
   where operation='private_media_cleanup'
$$;

revoke all on function public.claim_private_media_cleanup(),
  public.release_private_media_cleanup() from public,anon,authenticated;
grant execute on function public.claim_private_media_cleanup(),
  public.release_private_media_cleanup() to service_role;

insert into public.rglrs_migrations(version,filename)
values(29,'029_private_media_cleanup_lease.sql')
on conflict(version) do update set filename=excluded.filename;