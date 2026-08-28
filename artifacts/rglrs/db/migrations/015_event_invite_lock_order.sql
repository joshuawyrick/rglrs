-- Serialize event authorization and invite state with one lock order:
-- event row -> invite row -> redemption row. This matches membership mutation
-- and avoids event/invite inversion between redeem, revoke, and decide.

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
  -- Lock every affected event in UUID order before changing membership.
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
     select 1 from public.event_members em where em.event_id=v_event and em.user_id=auth.uid()
       and (em.role in ('owner','admin') or em.user_id=i.created_by)
   ) returning id into v_id;
  return v_id is not null;
end $$;

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
  select owner_id into v_owner from public.events where id=v_event;
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
      values(v_event,auth.uid(),v_role,v_mode)
      on conflict(event_id,user_id) do update set
        role=case when public.event_members.role in ('owner','admin') then public.event_members.role else excluded.role end,
        participation_mode=case when public.event_members.role in ('owner','admin') then 'participate' else excluded.participation_mode end;
    insert into public.event_invite_redemptions(invite_id,user_id,status,decided_at)
      values(v_inv.id,auth.uid(),'accepted',now());
  end if;
  update public.invites set use_count=use_count+1 where id=v_inv.id;
  return v_event;
end $$;

create or replace function public.decide_event_invite_redemption_secure(
  p_invite uuid,p_user uuid,p_accept boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_mode text; v_owner uuid; v_status text; v_role public.event_role; v_participation text;
begin
  if auth.uid() is null or p_invite is null or p_user is null or p_accept is null then raise exception 'invalid invite decision'; end if;
  select event_id into v_event from public.invites where id=p_invite;
  if v_event is null then raise exception 'event administrator required'; end if;
  -- Authorization is deliberately evaluated only after the event lock.
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

revoke all on function public.block_member(uuid),
  public.leave_event_secure(uuid),
  public.revoke_event_invite_secure(uuid),
  public.redeem_event_invite_secure(text,text),
  public.decide_event_invite_redemption_secure(uuid,uuid,boolean)
from public,anon,authenticated;
grant execute on function public.block_member(uuid),
  public.leave_event_secure(uuid),
  public.revoke_event_invite_secure(uuid),
  public.redeem_event_invite_secure(text,text),
  public.decide_event_invite_redemption_secure(uuid,uuid,boolean)
to authenticated;