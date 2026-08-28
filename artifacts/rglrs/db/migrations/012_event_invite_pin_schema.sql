-- Keep SECURITY DEFINER search paths locked while calling Supabase's pgcrypto schema.
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
    case when p_pin is null then null else extensions.crypt(p_pin,extensions.gen_salt('bf',10)) end,
    p_expires_at,p_max_uses)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.redeem_event_invite_secure(p_token_hash text,p_pin text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inv public.invites%rowtype; v_owner uuid; v_role public.event_role;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into v_inv from public.invites where token_hash=p_token_hash for update;
  if not found then raise exception 'invalid invite'; end if;
  if exists(select 1 from public.event_invite_redemptions where invite_id=v_inv.id and user_id=auth.uid()) then return v_inv.event_id; end if;
  if v_inv.revoked_at is not null or v_inv.expires_at is null or v_inv.expires_at<=now()
     or (v_inv.max_uses is not null and v_inv.use_count>=v_inv.max_uses)
     or (v_inv.pin_hash is not null and (p_pin is null or extensions.crypt(p_pin,v_inv.pin_hash)<>v_inv.pin_hash))
  then raise exception 'invite unavailable'; end if;
  select owner_id into v_owner from public.events where id=v_inv.event_id;
  if v_owner is null or public.is_blocked(v_owner,auth.uid()) or public.is_blocked(v_inv.created_by,auth.uid()) then raise exception 'invite unavailable'; end if;
  if v_inv.mode='approval' then
    insert into public.event_invite_redemptions(invite_id,user_id,status) values(v_inv.id,auth.uid(),'pending');
  else
    v_role:=case when v_inv.mode='view_only' then 'viewer'::public.event_role else 'member'::public.event_role end;
    insert into public.event_members(event_id,user_id,role) values(v_inv.event_id,auth.uid(),v_role) on conflict(event_id,user_id) do nothing;
    insert into public.event_invite_redemptions(invite_id,user_id,status,decided_at) values(v_inv.id,auth.uid(),'accepted',now());
  end if;
  update public.invites set use_count=use_count+1 where id=v_inv.id;
  return v_inv.event_id;
end $$;
revoke all on function public.create_event_invite_secure(uuid,text,text,text,timestamptz,integer),
  public.redeem_event_invite_secure(text,text) from public,anon;
grant execute on function public.create_event_invite_secure(uuid,text,text,text,timestamptz,integer),
  public.redeem_event_invite_secure(text,text) to authenticated;