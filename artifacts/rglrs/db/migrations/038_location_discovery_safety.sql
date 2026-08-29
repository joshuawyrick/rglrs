-- Public and anonymous location discovery is deny-by-default until a
-- server-managed age/family-safety policy can establish eligibility.

create table private.location_discovery_eligibility (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  eligible boolean not null default false,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
revoke all on private.location_discovery_eligibility from public,anon,authenticated;
grant select,insert,update,delete on private.location_discovery_eligibility to service_role;

create or replace function public.can_use_public_location_discovery(p_owner uuid)
returns boolean language sql stable security definer set search_path=public,private,pg_temp as $$
  select exists(
    select 1 from private.location_discovery_eligibility e
     where e.user_id=p_owner and e.eligible=true
  )
$$;

create or replace function public.can_view_live_location(p_owner uuid,p_viewer uuid)
returns boolean language plpgsql stable security definer set search_path=public,private,pg_temp as $$
declare
  v_session public.location_sharing_sessions%rowtype;
  v_override boolean;
begin
  if p_owner is null or p_viewer is null then return false; end if;
  if p_owner=p_viewer then return true; end if;
  if public.is_blocked(p_owner,p_viewer) then return false; end if;

  select can_view_location into v_override
    from public.person_privacy_overrides
   where owner_id=p_owner and person_id=p_viewer;
  if v_override is false then return false; end if;

  select * into v_session
    from public.location_sharing_sessions
   where owner_id=p_owner
     and ended_at is null
     and (share_until is null or share_until>now());
  if not found then return false; end if;

  if v_session.audience in ('everyone','anonymous') then
    return public.can_use_public_location_discovery(p_owner);
  elsif v_session.audience='friends' then
    return public.is_friend(p_owner,p_viewer);
  elsif v_session.audience='selected' then
    return public.is_friend(p_owner,p_viewer)
       and exists(select 1 from public.location_share_targets t where t.owner_id=p_owner and t.target_id=p_viewer);
  elsif v_session.audience='event' then
    return exists(
      select 1 from public.event_members m
       where m.event_id=v_session.event_id and m.user_id=p_owner
    ) and public.can_view_event(v_session.event_id,p_viewer);
  end if;
  return false;
end $$;

create or replace function public.start_location_sharing_secure(
  p_audience text,
  p_precision text,
  p_event_id uuid default null,
  p_target_ids uuid[] default '{}'::uuid[],
  p_duration_minutes integer default 60,
  p_checkin_ttl_minutes integer default 120,
  p_place_label text default null,
  p_public_discovery_ack boolean default false
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_actor uuid:=auth.uid();
  v_session uuid:=gen_random_uuid();
  v_target uuid;
  v_until timestamptz;
  v_label text:=nullif(btrim(coalesce(p_place_label,'')),'');
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  p_target_ids:=coalesce((select array_agg(distinct x) from unnest(coalesce(p_target_ids,'{}'::uuid[])) x),'{}'::uuid[]);
  if p_audience not in ('friends','selected','event','everyone','anonymous')
     or p_precision not in ('precise','approximate')
     or p_checkin_ttl_minutes not in (0,30,120,480)
     or cardinality(p_target_ids)>200
     or coalesce(char_length(v_label),0)>120
  then raise exception 'invalid location sharing settings'; end if;
  if p_audience='anonymous' then p_precision:='approximate'; end if;
  if p_audience in ('everyone','anonymous') then
    if not public.can_use_public_location_discovery(v_actor) then
      raise exception 'public location discovery is not enabled for this account';
    end if;
    if not coalesce(p_public_discovery_ack,false) then
      raise exception 'public discovery acknowledgement required';
    end if;
  end if;
  if p_duration_minutes is not null and p_duration_minutes not in (15,60,480) then
    raise exception 'invalid sharing duration';
  end if;
  if p_duration_minutes is not null then v_until:=now()+make_interval(mins=>p_duration_minutes); end if;

  if p_audience='event' then
    if p_event_id is null or not public.can_view_event(p_event_id,v_actor) then raise exception 'invalid event'; end if;
    if not exists(select 1 from public.event_members where event_id=p_event_id and user_id=v_actor) then raise exception 'event membership required'; end if;
    select least(coalesce(v_until,'infinity'::timestamptz),coalesce(ends_at,'infinity'::timestamptz))
      into v_until from public.events where id=p_event_id;
    if v_until='infinity'::timestamptz then v_until:=null; end if;
  elsif p_event_id is not null then
    raise exception 'event only valid for event audience';
  end if;

  if p_audience='selected' and coalesce(cardinality(p_target_ids),0)=0 then raise exception 'choose at least one friend'; end if;
  if p_audience<>'selected' and coalesce(cardinality(p_target_ids),0)<>0 then raise exception 'selected targets only valid for selected audience'; end if;
  foreach v_target in array coalesce(p_target_ids,'{}'::uuid[]) loop
    if v_target=v_actor or not public.is_friend(v_actor,v_target) or public.is_blocked(v_actor,v_target) then
      raise exception 'invalid selected friend';
    end if;
  end loop;

  insert into public.location_sharing_sessions(owner_id,session_id,audience,precision,event_id,share_duration_minutes,share_until,checkin_ttl_minutes,place_label,public_discovery_ack_at,started_at,ended_at,updated_at)
  values(v_actor,v_session,p_audience,p_precision,p_event_id,p_duration_minutes,v_until,p_checkin_ttl_minutes,v_label,
    case when p_audience in ('everyone','anonymous') then now() end,now(),null,now())
  on conflict(owner_id) do update set
    session_id=excluded.session_id,audience=excluded.audience,precision=excluded.precision,event_id=excluded.event_id,
    share_duration_minutes=excluded.share_duration_minutes,share_until=excluded.share_until,
    checkin_ttl_minutes=excluded.checkin_ttl_minutes,place_label=excluded.place_label,
    public_discovery_ack_at=excluded.public_discovery_ack_at,started_at=now(),ended_at=null,updated_at=now();

  delete from public.location_share_targets where owner_id=v_actor;
  if p_audience='selected' then
    insert into public.location_share_targets(owner_id,target_id)
      select v_actor,x from unnest(p_target_ids) x on conflict do nothing;
  end if;
  return v_session;
end $$;

create or replace function public.get_my_location_sharing_secure()
returns jsonb language sql stable security definer set search_path=public,private,pg_temp as $$
  select jsonb_build_object(
    'active',coalesce(s.ended_at is null and (s.share_until is null or s.share_until>now()),false),
    'session_id',s.session_id,'audience',s.audience,'precision',s.precision,'event_id',s.event_id,
    'share_duration_minutes',s.share_duration_minutes,'share_until',s.share_until,
    'checkin_ttl_minutes',s.checkin_ttl_minutes,'place_label',s.place_label,
    'public_discovery_acknowledged',s.public_discovery_ack_at is not null,
    'public_discovery_eligible',public.can_use_public_location_discovery(auth.uid()),
    'started_at',s.started_at,'last_update',l.captured_at,
    'target_ids',coalesce((select jsonb_agg(t.target_id order by t.target_id) from public.location_share_targets t where t.owner_id=auth.uid()),'[]'::jsonb)
  )
  from (select * from public.location_sharing_sessions where owner_id=auth.uid()) s
  left join private.current_locations l on l.owner_id=s.owner_id
  union all
  select jsonb_build_object(
    'active',false,'target_ids','[]'::jsonb,
    'public_discovery_eligible',public.can_use_public_location_discovery(auth.uid())
  )
  where not exists(select 1 from public.location_sharing_sessions where owner_id=auth.uid())
  limit 1
$$;

create or replace function public.get_whats_crackin_nearby(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 16093
) returns table(
  pin_id text,user_id uuid,display_name text,username text,avatar_upload_id uuid,
  latitude double precision,longitude double precision,distance_m integer,
  presence_state text,captured_at timestamptz,place_label text,is_friend boolean,
  is_anonymous boolean,audience text
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
  select d.* from displayed d where extensions.st_dwithin(d.display_point,d.viewer_point,p_radius_m)
)
select
  case when d.anonymous_identity then 'anon-'||substr(md5(d.session_id::text||date_trunc('hour',d.captured_at)::text),1,16) else d.owner_id::text end,
  case when d.anonymous_identity then null else d.owner_id end,
  case when d.anonymous_identity then null else d.display_name end,
  case when d.anonymous_identity or not public.can_find_username(d.owner_id,d.viewer_id) then null else d.username end,
  case when d.anonymous_identity or not public.can_view_profile_photo(d.owner_id,d.viewer_id) then null else d.avatar_upload_id end,
  extensions.st_y(d.display_point::extensions.geometry),extensions.st_x(d.display_point::extensions.geometry),
  round(extensions.st_distance(d.display_point,d.viewer_point))::integer,d.state,d.captured_at,
  case when d.anonymous_identity or d.audience in ('everyone','anonymous') then null else d.place_label end,
  d.friend,d.anonymous_identity,d.audience
from bounded d
order by extensions.st_distance(d.display_point,d.viewer_point)
limit 250
$$;

revoke all on function public.can_use_public_location_discovery(uuid) from public,anon,authenticated;
revoke all on function public.can_view_live_location(uuid,uuid) from public,anon,authenticated;
revoke all on function public.start_location_sharing_secure(text,text,uuid,uuid[],integer,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.get_my_location_sharing_secure() from public,anon,authenticated;
revoke all on function public.get_whats_crackin_nearby(double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.start_location_sharing_secure(text,text,uuid,uuid[],integer,integer,text,boolean) to authenticated;
grant execute on function public.get_my_location_sharing_secure() to authenticated;
grant execute on function public.get_whats_crackin_nearby(double precision,double precision,integer) to authenticated;

insert into public.rglrs_migrations(version,filename)
values(38,'038_location_discovery_safety.sql')
on conflict(version) do update set filename=excluded.filename;