-- Supabase pgcrypto exposes the portable one-argument Blowfish salt form.
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
revoke all on function public.create_event_invite_secure(uuid,text,text,text,timestamptz,integer)
  from public,anon;
grant execute on function public.create_event_invite_secure(uuid,text,text,text,timestamptz,integer)
  to authenticated;