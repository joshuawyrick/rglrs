-- Forward fix for databases that already applied migrations 010 through 012.

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
alter table public.event_members drop constraint if exists event_members_participation_mode_check;
alter table public.event_members add constraint event_members_participation_mode_check check(
  (role in ('owner','admin') and participation_mode='participate')
  or (role='member' and participation_mode in ('participate','upload_only'))
  or (role='viewer' and participation_mode='view_only')
);

alter table public.event_invite_redemptions add column if not exists decided_by uuid
  references public.profiles(id) on delete set null;
alter table public.event_invite_redemptions drop constraint if exists event_invite_redemptions_status_check;
alter table public.event_invite_redemptions add constraint event_invite_redemptions_status_check
  check(status in ('pending','accepted','declined'));
drop policy if exists "authors insert posts" on public.posts;
drop policy if exists "authors insert non-event posts" on public.posts;
create policy "authors insert non-event posts" on public.posts for insert to authenticated
  with check(author_id=auth.uid() and event_id is null and audience_kind<>'events');

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

create or replace function public.redeem_event_invite_secure(p_token_hash text,p_pin text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inv public.invites%rowtype; v_owner uuid; v_role public.event_role; v_mode text;
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
   );
  if v_event is null then raise exception 'event administrator required'; end if;
  select status into v_status from public.event_invite_redemptions
   where invite_id=p_invite and user_id=p_user for update;
  if v_status is distinct from 'pending' then return false; end if;
  if p_accept then
    if public.is_blocked(v_owner,p_user) then raise exception 'requester is blocked'; end if;
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

create or replace function public.create_post_secure(
  p_caption text,p_audience text,p_subject_ids uuid[],p_media jsonb
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

revoke all on function public.set_event_member_secure(uuid,uuid,text,boolean),
  public.redeem_event_invite_secure(text,text),
  public.decide_event_invite_redemption_secure(uuid,uuid,boolean),
  public.list_event_invite_requests_secure(uuid),
  public.create_post_secure(text,text,uuid[],jsonb)
from public,anon,authenticated;
grant execute on function public.set_event_member_secure(uuid,uuid,text,boolean),
  public.redeem_event_invite_secure(text,text),
  public.decide_event_invite_redemption_secure(uuid,uuid,boolean),
  public.list_event_invite_requests_secure(uuid),
  public.create_post_secure(text,text,uuid[],jsonb)
to authenticated;