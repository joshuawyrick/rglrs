-- Forward hardening for approval races, shared-event blocks, and PIN guessing.

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

-- Invalid tokens, unavailable invites, wrong PINs, and throttled PINs all return
-- NULL. Returning normally is required so failed PIN counters commit.
create or replace function public.redeem_event_invite_secure(p_token_hash text,p_pin text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_inv public.invites%rowtype; v_owner uuid; v_role public.event_role; v_mode text;
  v_window timestamptz:=date_bin(interval '15 minutes',now(),timestamptz '2000-01-01');
  v_attempts integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_inv from public.invites where token_hash=p_token_hash for update;
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
    v_role:=case when v_inv.mode='view_only' then 'viewer'::public.event_role else 'member'::public.event_role end;
    v_mode:=v_inv.mode;
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
  select i.event_id,i.mode,e.owner_id into v_event,v_mode,v_owner
    from public.invites i join public.events e on e.id=i.event_id
   where i.id=p_invite and exists(
     select 1 from public.event_members admin
      where admin.event_id=i.event_id and admin.user_id=auth.uid() and admin.role in ('owner','admin')
   ) for update of i;
  if v_event is null then raise exception 'event administrator required'; end if;
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

revoke all on function public.block_member(uuid),
  public.redeem_event_invite_secure(text,text),
  public.decide_event_invite_redemption_secure(uuid,uuid,boolean)
from public,anon,authenticated;
grant execute on function public.block_member(uuid),
  public.redeem_event_invite_secure(text,text),
  public.decide_event_invite_redemption_secure(uuid,uuid,boolean)
to authenticated;