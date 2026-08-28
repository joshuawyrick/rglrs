-- Secure friendship, circle, event, membership, and invite workflows.
-- Forward-only: existing rows are retained and normalized before constraints.

create extension if not exists pgcrypto;

-- Move the legacy friendship-level block state into the authoritative blocks
-- table, then sever every friendship for those pairs as block_member does.
insert into public.blocks(blocker_id,blocked_id)
select requester_id,addressee_id from public.friendships where status='blocked'
on conflict do nothing;
delete from public.friendships f using public.blocks b
 where (f.requester_id=b.blocker_id and f.addressee_id=b.blocked_id)
    or (f.requester_id=b.blocked_id and f.addressee_id=b.blocker_id);

-- Keep one row for each unordered friendship pair. Accepted relationships win,
-- followed by pending, declined, and the legacy blocked status.
with ranked as (
  select id,
         row_number() over (
           partition by least(requester_id,addressee_id), greatest(requester_id,addressee_id)
           order by case status when 'accepted' then 1 when 'pending' then 2 when 'declined' then 3 else 4 end,
                    updated_at desc, id
         ) as rn
    from public.friendships
)
delete from public.friendships f using ranked r where f.id=r.id and r.rn>1;
create unique index if not exists friendships_canonical_pair_idx
  on public.friendships(least(requester_id,addressee_id),greatest(requester_id,addressee_id));
create index if not exists friendships_addressee_status_idx
  on public.friendships(addressee_id,status,updated_at desc);

update public.events set description='' where description is null;
update public.events set ends_at=null where starts_at is null and ends_at is not null;
update public.events set ends_at=starts_at where starts_at is not null and ends_at is not null and ends_at<starts_at;
update public.invites set use_count=greatest(use_count,0);
update public.invites set max_uses=greatest(max_uses,use_count,1) where max_uses is not null;
update public.event_members em set role='member'
  from public.events e where e.id=em.event_id and em.role='owner' and em.user_id<>e.owner_id;
insert into public.event_members(event_id,user_id,role)
select id,owner_id,'owner' from public.events
on conflict(event_id,user_id) do update set role='owner';
alter table public.event_members add column if not exists participation_mode text;
update public.event_members
   set participation_mode=case when role='viewer' then 'view_only' else 'participate' end
 where participation_mode is null
    or participation_mode not in ('participate','upload_only','view_only')
    or (role='viewer' and participation_mode<>'view_only')
    or (role in ('owner','admin') and participation_mode<>'participate')
    or (role='member' and participation_mode='view_only');
alter table public.event_members alter column participation_mode set default 'participate';
alter table public.event_members alter column participation_mode set not null;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='events_valid_date_range' and conrelid='public.events'::regclass) then
    alter table public.events add constraint events_valid_date_range
      check(ends_at is null or (starts_at is not null and ends_at>=starts_at));
  end if;
  if not exists(select 1 from pg_constraint where conname='events_description_length' and conrelid='public.events'::regclass) then
    alter table public.events add constraint events_description_length check(char_length(description)<=5000);
  end if;
  if not exists(select 1 from pg_constraint where conname='events_place_name_length' and conrelid='public.events'::regclass) then
    alter table public.events add constraint events_place_name_length check(place_name is null or char_length(trim(place_name)) between 1 and 200);
  end if;
  if not exists(select 1 from pg_constraint where conname='invites_use_bounds' and conrelid='public.invites'::regclass) then
    alter table public.invites add constraint invites_use_bounds
      check(use_count>=0 and (max_uses is null or (max_uses between 1 and 10000 and use_count<=max_uses)));
  end if;
  if not exists(select 1 from pg_constraint where conname='event_members_participation_mode_check' and conrelid='public.event_members'::regclass) then
    alter table public.event_members add constraint event_members_participation_mode_check check(
      (role in ('owner','admin') and participation_mode='participate')
      or (role='member' and participation_mode in ('participate','upload_only'))
      or (role='viewer' and participation_mode='view_only')
    );
  end if;
end $$;
create index if not exists invites_event_active_idx on public.invites(event_id,created_at desc) where revoked_at is null;
create index if not exists invites_expiry_idx on public.invites(expires_at) where revoked_at is null;

create table if not exists public.event_invite_redemptions (
  invite_id uuid not null references public.invites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check(status in ('pending','accepted','declined')),
  redeemed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  primary key(invite_id,user_id)
);
alter table public.event_invite_redemptions drop constraint if exists event_invite_redemptions_status_check;
alter table public.event_invite_redemptions add constraint event_invite_redemptions_status_check
  check(status in ('pending','accepted','declined'));
create index if not exists event_invite_redemptions_user_idx
  on public.event_invite_redemptions(user_id,redeemed_at desc);
alter table public.event_invite_redemptions enable row level security;

create table if not exists private.invite_pin_attempts (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  invite_id uuid not null references public.invites(id) on delete cascade,
  window_started timestamptz not null,
  attempts integer not null check(attempts between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key(actor_id,invite_id,window_started)
);
alter table private.invite_pin_attempts enable row level security;
revoke all on private.invite_pin_attempts from public,anon,authenticated;

-- Browser clients may read only rows relevant to them; every mutation below is
-- RPC-only so actor ids and state transitions cannot be forged.
drop policy if exists "requester creates friendship" on public.friendships;
drop policy if exists "requester creates unblocked friendship" on public.friendships;
drop policy if exists "participants update friendship" on public.friendships;
drop policy if exists "participants update unblocked friendship" on public.friendships;
drop policy if exists "circle owner writes" on public.circles;
drop policy if exists "circle owner manages members" on public.circle_members;
drop policy if exists "circle owner manages eligible members" on public.circle_members;
drop policy if exists "event owner writes event" on public.events;
drop policy if exists "event owner manages membership" on public.event_members;
drop policy if exists "event owner manages unblocked membership" on public.event_members;
drop policy if exists "event owners read invites" on public.invites;
drop policy if exists "event owners create invites" on public.invites;
drop policy if exists "invite creators update" on public.invites;

revoke insert,update,delete on public.friendships,public.circles,public.circle_members,
  public.events,public.event_members,public.invites,public.event_invite_redemptions
  from public,authenticated,anon;
revoke select on public.invites from public,authenticated,anon;
grant select on public.event_invite_redemptions to authenticated;
drop policy if exists "users read invite redemptions" on public.event_invite_redemptions;
create policy "users read invite redemptions" on public.event_invite_redemptions
  for select to authenticated using(user_id=auth.uid());
drop policy if exists "authors insert posts" on public.posts;
create policy "authors insert non-event posts" on public.posts for insert to authenticated
  with check(author_id=auth.uid() and event_id is null and audience_kind<>'events');

create or replace function public.block_member(p_blocked uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or p_blocked is null or p_blocked=v_actor then raise exception 'invalid block target'; end if;
  if not exists(select 1 from public.profiles where id=p_blocked) then raise exception 'invalid block target'; end if;
  insert into public.blocks(blocker_id,blocked_id) values(v_actor,p_blocked) on conflict do nothing;
  delete from public.friendships where (requester_id=v_actor and addressee_id=p_blocked) or (requester_id=p_blocked and addressee_id=v_actor);
  delete from public.circle_members cm using public.circles c
   where cm.circle_id=c.id
     and ((c.owner_id=v_actor and cm.user_id=p_blocked) or (c.owner_id=p_blocked and cm.user_id=v_actor));
  -- Owners keep their invariant row. An owner removes the blocked member; a
  -- member blocking the owner leaves; in a third-party event the blocker leaves.
  perform 1 from public.events e
   where (e.owner_id=v_actor and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=p_blocked))
      or (e.owner_id=p_blocked and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=v_actor))
      or (e.owner_id not in (v_actor,p_blocked)
          and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=v_actor)
          and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=p_blocked))
   order by e.id for update;
  delete from public.event_members em using public.events e
   where em.event_id=e.id and em.role<>'owner' and (
     (e.owner_id=v_actor and em.user_id=p_blocked)
     or (e.owner_id=p_blocked and em.user_id=v_actor)
     or (
       e.owner_id not in (v_actor,p_blocked)
       and em.user_id=v_actor
       and exists(select 1 from public.event_members peer where peer.event_id=e.id and peer.user_id=p_blocked)
     )
   );
end $$;

create or replace function public.create_friend_request_secure(p_addressee uuid)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_row public.friendships%rowtype;
begin
  if v_actor is null or p_addressee is null or p_addressee=v_actor
     or not exists(select 1 from public.profiles where id=p_addressee)
     or public.is_blocked(v_actor,p_addressee)
  then raise exception 'invalid friend request'; end if;
  perform private.enforce_write_rate(v_actor,'friendships',30);
  perform pg_advisory_xact_lock(hashtextextended(least(v_actor::text,p_addressee::text)||greatest(v_actor::text,p_addressee::text),0));
  select * into v_row from public.friendships
   where least(requester_id,addressee_id)=least(v_actor,p_addressee)
     and greatest(requester_id,addressee_id)=greatest(v_actor,p_addressee)
   for update;
  if found and v_row.status in ('accepted','pending') then return v_row.id; end if;
  if found then
    update public.friendships set requester_id=v_actor,addressee_id=p_addressee,status='pending',updated_at=now()
     where id=v_row.id returning id into v_row.id;
    return v_row.id;
  end if;
  insert into public.friendships(requester_id,addressee_id,status)
  values(v_actor,p_addressee,'pending') returning id into v_row.id;
  return v_row.id;
end $$;

create or replace function public.respond_friend_request_secure(p_friendship uuid,p_response text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_response not in ('accepted','declined') then raise exception 'invalid friend response'; end if;
  update public.friendships set status=p_response::public.friendship_status,updated_at=now()
   where id=p_friendship and addressee_id=auth.uid() and status='pending'
     and not public.is_blocked(requester_id,addressee_id)
  returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.remove_friendship_secure(p_friendship uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  delete from public.friendships where id=p_friendship
    and auth.uid() in (requester_id,addressee_id) and status in ('accepted','declined')
  returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.create_circle_secure(p_name text,p_emoji text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_name,''))) not between 1 and 80
     or char_length(coalesce(p_emoji,''))>16 then raise exception 'invalid circle'; end if;
  insert into public.circles(owner_id,name,emoji)
  values(auth.uid(),trim(p_name),nullif(trim(p_emoji),'')) returning id into v_id;
  return v_id;
end $$;

create or replace function public.set_circle_members_secure(p_circle uuid,p_members uuid[])
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_members uuid[]; v_member uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.circles where id=p_circle and owner_id=auth.uid())
  then raise exception 'circle owner required'; end if;
  select coalesce(array_agg(distinct x),'{}'::uuid[]) into v_members from unnest(coalesce(p_members,'{}'::uuid[])) x;
  if cardinality(v_members)>200 or auth.uid()=any(v_members) then raise exception 'invalid circle members'; end if;
  foreach v_member in array v_members loop
    if not exists(select 1 from public.profiles where id=v_member)
       or not public.is_friend(auth.uid(),v_member) or public.is_blocked(auth.uid(),v_member)
    then raise exception 'ineligible circle member'; end if;
  end loop;
  delete from public.circle_members where circle_id=p_circle and not(user_id=any(v_members));
  insert into public.circle_members(circle_id,user_id)
    select p_circle,x from unnest(v_members) x on conflict do nothing;
  return true;
end $$;

create or replace function public.create_event_secure(
  p_title text,p_description text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_place_name text,p_members_can_invite boolean
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_title,''))) not between 1 and 140
     or char_length(coalesce(p_description,''))>5000
     or (p_ends_at is not null and (p_starts_at is null or p_ends_at<p_starts_at))
     or (p_place_name is not null and char_length(trim(p_place_name)) not between 1 and 200)
  then raise exception 'invalid event'; end if;
  insert into public.events(owner_id,title,description,starts_at,ends_at,place_name,members_can_invite)
  values(auth.uid(),trim(p_title),coalesce(p_description,''),p_starts_at,p_ends_at,nullif(trim(p_place_name),''),coalesce(p_members_can_invite,false))
  returning id into v_id;
  insert into public.event_members(event_id,user_id,role,participation_mode)
  values(v_id,auth.uid(),'owner','participate');
  return v_id;
end $$;

create or replace function public.update_event_secure(
  p_event uuid,p_title text,p_description text,p_starts_at timestamptz,p_ends_at timestamptz,
  p_place_name text,p_members_can_invite boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_title,''))) not between 1 and 140
     or char_length(coalesce(p_description,''))>5000
     or (p_ends_at is not null and (p_starts_at is null or p_ends_at<p_starts_at))
     or (p_place_name is not null and char_length(trim(p_place_name)) not between 1 and 200)
  then raise exception 'invalid event'; end if;
  update public.events e set title=trim(p_title),description=coalesce(p_description,''),starts_at=p_starts_at,
    ends_at=p_ends_at,place_name=nullif(trim(p_place_name),''),members_can_invite=coalesce(p_members_can_invite,false)
  where e.id=p_event and exists(
    select 1 from public.event_members em
     where em.event_id=e.id and em.user_id=auth.uid() and em.role in ('owner','admin')
  ) returning e.id into v_id;
  return v_id is not null;
end $$;

create or replace function public.delete_event_secure(p_event uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  delete from public.events where id=p_event and owner_id=auth.uid() returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.set_event_member_secure(p_event uuid,p_user uuid,p_role text,p_present boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor_role public.event_role; v_owner uuid; v_existing public.event_role;
begin
  if auth.uid() is null or p_user is null or p_role not in ('admin','member','viewer') then raise exception 'invalid membership'; end if;
  select e.owner_id,em.role into v_owner,v_actor_role from public.events e
    join public.event_members em on em.event_id=e.id and em.user_id=auth.uid() where e.id=p_event for update of e;
  if v_actor_role not in ('owner','admin') then raise exception 'event administrator required'; end if;
  if p_user=v_owner then raise exception 'event owner cannot be changed'; end if;
  select role into v_existing from public.event_members where event_id=p_event and user_id=p_user;
  if v_actor_role='admin' and (p_role='admin' or v_existing='admin') then raise exception 'owner required for admin changes'; end if;
  if coalesce(p_present,false) then
    if not exists(select 1 from public.profiles where id=p_user)
       or public.is_blocked(v_owner,p_user) or public.is_blocked(auth.uid(),p_user)
       or not public.is_friend(v_owner,p_user)
    then raise exception 'ineligible event member'; end if;
    insert into public.event_members(event_id,user_id,role,participation_mode)
    values(p_event,p_user,p_role::public.event_role,case when p_role='viewer' then 'view_only' else 'participate' end)
      on conflict(event_id,user_id) do update
        set role=excluded.role,participation_mode=excluded.participation_mode;
  else
    delete from public.event_members where event_id=p_event and user_id=p_user;
  end if;
  return true;
end $$;

create or replace function public.leave_event_secure(p_event uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform 1 from public.events where id=p_event for update;
  delete from public.event_members where event_id=p_event and user_id=auth.uid() and role<>'owner'
  returning event_id into v_event;
  return v_event is not null;
end $$;

create or replace function public.create_event_invite_secure(
  p_event uuid,p_token_hash text,p_mode text,p_pin text,p_expires_at timestamptz,p_max_uses integer
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_role public.event_role; v_open boolean;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select em.role,e.members_can_invite into v_role,v_open from public.events e
    join public.event_members em on em.event_id=e.id and em.user_id=auth.uid() where e.id=p_event;
  if v_role is null or (v_role not in ('owner','admin') and not(v_role='member' and v_open)) then raise exception 'invite permission denied'; end if;
  if p_mode not in ('participate','upload_only','view_only','approval')
     or trim(coalesce(p_token_hash,'')) !~ '^[0-9a-f]{64}$'
     or (p_pin is not null and p_pin !~ '^[0-9]{4,12}$')
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 year'
     or p_max_uses is not null and p_max_uses not between 1 and 10000
  then raise exception 'invalid invite'; end if;
  insert into public.invites(event_id,created_by,token_hash,mode,pin_hash,expires_at,max_uses)
  values(p_event,auth.uid(),trim(p_token_hash),p_mode,
    case when p_pin is null then null else extensions.crypt(p_pin,extensions.gen_salt('bf',10)) end,p_expires_at,p_max_uses)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revoke_event_invite_secure(p_invite uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_event uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select event_id into v_event from public.invites where id=p_invite;
  if v_event is null then return false; end if;
  perform 1 from public.events where id=v_event for update;
  update public.invites i set revoked_at=coalesce(revoked_at,now())
   where i.id=p_invite and i.event_id=v_event and exists(
     select 1 from public.event_members em where em.event_id=i.event_id and em.user_id=auth.uid()
       and (em.role in ('owner','admin') or em.user_id=i.created_by)
   ) returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.list_event_invites_secure(p_event uuid)
returns table(
  id uuid,mode text,expires_at timestamptz,max_uses integer,use_count integer,
  revoked_at timestamptz,created_at timestamptz,has_pin boolean
) language sql stable security definer set search_path=public,pg_temp as $$
  select i.id,i.mode,i.expires_at,i.max_uses,i.use_count,i.revoked_at,i.created_at,
         i.pin_hash is not null
    from public.invites i
   where i.event_id=p_event
     and exists(
       select 1 from public.event_members em
        where em.event_id=i.event_id and em.user_id=auth.uid()
          and (em.role in ('owner','admin') or em.user_id=i.created_by)
     )
   order by i.created_at desc;
$$;

-- Failure returns NULL rather than raising so PIN-attempt writes commit. Routes
-- must map every NULL to one generic failed-redemption response.
create or replace function public.redeem_event_invite_secure(p_token_hash text,p_pin text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_inv public.invites%rowtype; v_owner uuid; v_role public.event_role; v_mode text;
  v_event uuid;
  v_window timestamptz:=date_bin(interval '15 minutes',now(),timestamptz '2000-01-01');
  v_attempts integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select event_id into v_event from public.invites where token_hash=p_token_hash;
  if v_event is null then return null; end if;
  perform 1 from public.events where id=v_event for update;
  select * into v_inv from public.invites
   where token_hash=p_token_hash and event_id=v_event for update;
  if not found then return null; end if;
  if exists(select 1 from public.event_invite_redemptions where invite_id=v_inv.id and user_id=auth.uid()) then
    delete from private.invite_pin_attempts where actor_id=auth.uid() and invite_id=v_inv.id;
    return v_inv.event_id;
  end if;
  if v_inv.revoked_at is not null or v_inv.expires_at is null or v_inv.expires_at<=now()
     or (v_inv.max_uses is not null and v_inv.use_count>=v_inv.max_uses)
  then return null; end if;
  select owner_id into v_owner from public.events where id=v_inv.event_id;
  if v_owner is null or public.is_blocked(v_owner,auth.uid())
     or public.is_blocked(v_inv.created_by,auth.uid()) then return null; end if;
  if v_inv.pin_hash is not null then
    select attempts into v_attempts from private.invite_pin_attempts
     where actor_id=auth.uid() and invite_id=v_inv.id and window_started=v_window;
    if coalesce(v_attempts,0)>=5 then return null; end if;
    if p_pin is null or extensions.crypt(p_pin,v_inv.pin_hash)<>v_inv.pin_hash then
      insert into private.invite_pin_attempts(actor_id,invite_id,window_started,attempts)
      values(auth.uid(),v_inv.id,v_window,1)
      on conflict(actor_id,invite_id,window_started) do update
        set attempts=least(private.invite_pin_attempts.attempts+1,5),updated_at=now();
      return null;
    end if;
    delete from private.invite_pin_attempts where actor_id=auth.uid() and invite_id=v_inv.id;
  end if;
  if v_inv.mode='approval' then
    insert into public.event_invite_redemptions(invite_id,user_id,status) values(v_inv.id,auth.uid(),'pending');
  else
    v_role := case when v_inv.mode='view_only' then 'viewer'::public.event_role else 'member'::public.event_role end;
    v_mode := v_inv.mode;
    insert into public.event_members(event_id,user_id,role,participation_mode)
      values(v_inv.event_id,auth.uid(),v_role,v_mode)
      on conflict(event_id,user_id) do update set
        role=case when public.event_members.role in ('owner','admin') then public.event_members.role else excluded.role end,
        participation_mode=case when public.event_members.role in ('owner','admin') then 'participate' else excluded.participation_mode end;
    insert into public.event_invite_redemptions(invite_id,user_id,status,decided_at)
      values(v_inv.id,auth.uid(),'accepted',now());
  end if;
  update public.invites set use_count=use_count+1 where id=v_inv.id;
  return v_inv.event_id;
end $$;

create or replace function public.decide_event_invite_redemption_secure(
  p_invite uuid,p_user uuid,p_accept boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_mode text; v_owner uuid; v_status text; v_role public.event_role; v_participation text;
begin
  if auth.uid() is null or p_invite is null or p_user is null or p_accept is null then raise exception 'invalid invite decision'; end if;
  select event_id into v_event from public.invites where id=p_invite;
  if v_event is null then raise exception 'event administrator required'; end if;
  -- Global order for membership/invite workflows: event, invite, redemption.
  select owner_id into v_owner from public.events where id=v_event for update;
  if v_owner is null or not exists(
    select 1 from public.event_members admin
     where admin.event_id=v_event and admin.user_id=auth.uid() and admin.role in ('owner','admin')
  ) then raise exception 'event administrator required'; end if;
  select mode into v_mode from public.invites
   where id=p_invite and event_id=v_event for update;
  if v_mode is null then raise exception 'event administrator required'; end if;
  select status into v_status from public.event_invite_redemptions
   where invite_id=p_invite and user_id=p_user for update;
  if v_status is distinct from 'pending' then return false; end if;
  if p_accept then
    if not exists(
      select 1 from public.invites i where i.id=p_invite and i.revoked_at is null
        and i.expires_at>now() and i.use_count>0
        and (i.max_uses is null or i.use_count<=i.max_uses)
    ) or public.is_blocked(v_owner,p_user)
      or exists(select 1 from public.invites i where i.id=p_invite and public.is_blocked(i.created_by,p_user))
    then return false; end if;
    v_role:=case when v_mode='view_only' then 'viewer'::public.event_role else 'member'::public.event_role end;
    v_participation:=case when v_mode in ('participate','upload_only','view_only') then v_mode else 'participate' end;
    insert into public.event_members(event_id,user_id,role,participation_mode)
      values(v_event,p_user,v_role,v_participation)
      on conflict(event_id,user_id) do update set
        role=case when public.event_members.role in ('owner','admin') then public.event_members.role else excluded.role end,
        participation_mode=case when public.event_members.role in ('owner','admin') then 'participate' else excluded.participation_mode end;
  end if;
  update public.event_invite_redemptions
     set status=case when p_accept then 'accepted' else 'declined' end,decided_at=now(),decided_by=auth.uid()
   where invite_id=p_invite and user_id=p_user and status='pending';
  return found;
end $$;

create or replace function public.list_event_invite_requests_secure(p_event uuid)
returns table(
  invite_id uuid,mode text,user_id uuid,status text,redeemed_at timestamptz,decided_at timestamptz,
  decided_by uuid,display_name text,username text
) language sql stable security definer set search_path=public,pg_temp as $$
  select r.invite_id,i.mode,r.user_id,r.status,r.redeemed_at,r.decided_at,r.decided_by,p.display_name,p.username
    from public.event_invite_redemptions r
    join public.invites i on i.id=r.invite_id
    join public.profiles p on p.id=r.user_id
   where i.event_id=p_event
     and exists(
       select 1 from public.event_members admin
        where admin.event_id=p_event and admin.user_id=auth.uid() and admin.role in ('owner','admin')
     )
   order by r.redeemed_at desc;
$$;

-- A one-event audience is also the canonical event feed/gallery association.
create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid; v_subject uuid; v_item jsonb; v_order integer;
  v_rule public.audience_rule_type; v_upload_id uuid; v_upload public.media_uploads%rowtype;
  v_event_id uuid; v_event_role public.event_role; v_participation_mode text;
begin
  if auth.uid() is null or coalesce(char_length(p_caption),0)>220 or p_audience not in ('private','friends','circles','events','people','except') then raise exception 'invalid post input'; end if;
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
  insert into public.posts(author_id,event_id,caption,audience_kind)
  values(auth.uid(),v_event_id,coalesce(p_caption,''),p_audience) returning id into v_id;
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

revoke all on function public.create_friend_request_secure(uuid),
  public.respond_friend_request_secure(uuid,text),public.remove_friendship_secure(uuid),
  public.create_circle_secure(text,text),public.set_circle_members_secure(uuid,uuid[]),
  public.create_event_secure(text,text,timestamptz,timestamptz,text,boolean),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,boolean),
  public.delete_event_secure(uuid),public.set_event_member_secure(uuid,uuid,text,boolean),
  public.leave_event_secure(uuid),public.create_event_invite_secure(uuid,text,text,text,timestamptz,integer),
  public.revoke_event_invite_secure(uuid),public.list_event_invites_secure(uuid),
  public.redeem_event_invite_secure(text,text),public.decide_event_invite_redemption_secure(uuid,uuid,boolean),
  public.list_event_invite_requests_secure(uuid),public.create_post_secure(text,text,uuid[],jsonb)
from public,anon,authenticated;
grant execute on function public.create_friend_request_secure(uuid),
  public.respond_friend_request_secure(uuid,text),public.remove_friendship_secure(uuid),
  public.create_circle_secure(text,text),public.set_circle_members_secure(uuid,uuid[]),
  public.create_event_secure(text,text,timestamptz,timestamptz,text,boolean),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,boolean),
  public.delete_event_secure(uuid),public.set_event_member_secure(uuid,uuid,text,boolean),
  public.leave_event_secure(uuid),public.create_event_invite_secure(uuid,text,text,text,timestamptz,integer),
  public.revoke_event_invite_secure(uuid),public.list_event_invites_secure(uuid),
  public.redeem_event_invite_secure(text,text),public.decide_event_invite_redemption_secure(uuid,uuid,boolean),
  public.list_event_invite_requests_secure(uuid),public.create_post_secure(text,text,uuid[],jsonb)
to authenticated;
revoke all on function public.block_member(uuid) from public,anon,authenticated;
grant execute on function public.block_member(uuid) to authenticated;