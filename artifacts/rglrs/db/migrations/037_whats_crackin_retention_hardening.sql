-- Do not expose username when username discovery is denied, and give the existing
-- 15-minute maintenance job a service-only way to purge expired exact positions.

create or replace function public.get_whats_crackin_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 16093
) returns table(
  pin_id text,
  user_id uuid,
  display_name text,
  username text,
  avatar_upload_id uuid,
  latitude double precision,
  longitude double precision,
  distance_m integer,
  presence_state text,
  captured_at timestamptz,
  place_label text,
  is_friend boolean,
  is_anonymous boolean,
  audience text
) language sql stable security definer set search_path=public,private,pg_temp as $$
with viewer as (
  select auth.uid() as id,
    extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326)::extensions.geography as point
  where auth.uid() is not null and p_lat between -90 and 90 and p_lng between -180 and 180 and p_radius_m between 100 and 50000
), eligible as (
  select s.*,l.position,l.captured_at,p.display_name,p.username,p.avatar_upload_id,v.id viewer_id,v.point viewer_point,
    public.is_friend(s.owner_id,v.id) friend,
    (s.audience='anonymous' or not public.can_view_profile(s.owner_id,v.id)) anonymous_identity,
    case when l.captured_at>=now()-interval '5 minutes' then 'live' else 'checkin' end state
  from viewer v
  join public.location_sharing_sessions s on s.owner_id<>v.id
  join private.current_locations l on l.owner_id=s.owner_id
  join public.profiles p on p.id=s.owner_id
  where s.ended_at is null
    and (s.share_until is null or s.share_until>now())
    and public.can_view_live_location(s.owner_id,v.id)
    and (l.captured_at>=now()-interval '5 minutes'
      or (s.checkin_ttl_minutes>0 and l.captured_at+make_interval(mins=>s.checkin_ttl_minutes)>now()))
), displayed as (
  select e.*,
    case when e.precision='precise' and not e.anonymous_identity then e.position
      else extensions.st_project(
        e.position,
        (250 + mod(abs(hashtextextended(e.session_id::text||date_trunc('hour',e.captured_at)::text,17)),551))::double precision,
        radians(mod(abs(hashtextextended(e.session_id::text||date_trunc('hour',e.captured_at)::text,31)),360)::double precision)
      )
    end display_point
  from eligible e
), bounded as (
  select d.* from displayed d
   where extensions.st_dwithin(d.display_point,d.viewer_point,p_radius_m)
)
select
  case when d.anonymous_identity then 'anon-'||substr(md5(d.session_id::text||date_trunc('hour',d.captured_at)::text),1,16) else d.owner_id::text end,
  case when d.anonymous_identity then null else d.owner_id end,
  case when d.anonymous_identity then null else d.display_name end,
  case when d.anonymous_identity or not public.can_find_username(d.owner_id,d.viewer_id) then null else d.username end,
  case when d.anonymous_identity or not public.can_view_profile_photo(d.owner_id,d.viewer_id) then null else d.avatar_upload_id end,
  extensions.st_y(d.display_point::extensions.geometry),
  extensions.st_x(d.display_point::extensions.geometry),
  round(extensions.st_distance(d.display_point,d.viewer_point))::integer,
  d.state,
  d.captured_at,
  case when d.anonymous_identity or d.audience in ('everyone','anonymous') then null else d.place_label end,
  d.friend,
  d.anonymous_identity,
  d.audience
from bounded d
order by extensions.st_distance(d.display_point,d.viewer_point)
limit 250
$$;

create or replace function public.prune_expired_locations_secure()
returns integer language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_deleted integer:=0; v_sessions uuid[];
begin
  -- Exact positions are unnecessary once their session has ended/expired, or once
  -- the position is older than the longest supported check-in window.
  delete from private.current_locations l
   where l.captured_at<now()-interval '8 hours'
      or not exists(
        select 1 from public.location_sharing_sessions s
         where s.owner_id=l.owner_id and s.ended_at is null and (s.share_until is null or s.share_until>now())
      );
  get diagnostics v_deleted=row_count;

  select coalesce(array_agg(s.owner_id),'{}'::uuid[]) into v_sessions
    from public.location_sharing_sessions s
   where (s.ended_at is not null and s.ended_at<now()-interval '1 day')
      or (s.share_until is not null and s.share_until<now()-interval '1 day');
  delete from public.location_share_targets where owner_id=any(v_sessions);
  delete from public.location_sharing_sessions where owner_id=any(v_sessions);
  return v_deleted;
end $$;

revoke all on function public.prune_expired_locations_secure() from public,anon,authenticated;
revoke all on function public.can_view_live_location(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prune_expired_locations_secure() to service_role;

insert into public.rglrs_migrations(version,filename)
values(37,'037_whats_crackin_retention_hardening.sql')
on conflict(version) do update set filename=excluded.filename;
