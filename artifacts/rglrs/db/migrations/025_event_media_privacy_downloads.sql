-- Contributor-owned event media sharing and explicit download permission.
-- Event membership remains separate from a contributor's sharing choices.

alter table public.posts
  add column if not exists allow_downloads boolean not null default false;

create table if not exists public.event_media_exclusions (
  event_id uuid not null references public.events(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  excluded_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id,uploader_id,excluded_user_id),
  constraint event_media_exclusions_not_self check (uploader_id<>excluded_user_id)
);
create index if not exists event_media_exclusions_viewer_idx
  on public.event_media_exclusions(event_id,excluded_user_id,uploader_id);
alter table public.event_media_exclusions enable row level security;

alter table public.feed_invalidations
  drop constraint if exists feed_invalidations_reason_check;
alter table public.feed_invalidations
  add constraint feed_invalidations_reason_check
  check(reason in ('friendship','block','event_sharing','event_membership','post_audience'));

revoke all on public.event_media_exclusions from public,anon,authenticated;
grant select on public.event_media_exclusions to authenticated;
drop policy if exists "contributors read own event exclusions" on public.event_media_exclusions;
create policy "contributors read own event exclusions" on public.event_media_exclusions
  for select to authenticated
  using (
    uploader_id=auth.uid()
    and public.can_view_event(event_id,auth.uid())
  );

create or replace function public.can_view_post(p_post uuid,p_user uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  v_author uuid;
  v_event uuid;
begin
  select author_id,event_id into v_author,v_event
    from public.posts where id=p_post;
  if v_author is null then return false; end if;
  if v_author=p_user then return true; end if;
  if public.is_blocked(v_author,p_user) then return false; end if;

  -- A contributor's event sharing choice applies to every event upload they
  -- make, including uploads made before the choice changed.
  if v_event is not null then
    if not public.can_view_event(v_event,p_user)
       or exists(
         select 1 from public.event_media_exclusions x
          where x.event_id=v_event
            and x.uploader_id=v_author
            and x.excluded_user_id=p_user
       )
    then return false; end if;
  end if;

  -- Explicit post exclusions always win over every positive audience rule.
  if exists(
    select 1 from public.audience_rules r
     where r.post_id=p_post and r.rule_type='exclude_user' and r.subject_id=p_user
  ) then return false; end if;
  if exists(
    select 1 from public.audience_rules r
     where r.post_id=p_post and r.rule_type='include_user' and r.subject_id=p_user
  ) then return true; end if;
  if exists(
    select 1
      from public.audience_rules r
      join public.circles c on c.id=r.subject_id
     where r.post_id=p_post and r.rule_type='include_circle'
       and public.can_view_circle(c.id,p_user)
  ) then return true; end if;
  if exists(
    select 1
      from public.audience_rules r
      join public.events e on e.id=r.subject_id
     where r.post_id=p_post and r.rule_type='include_event'
       and public.can_view_event(e.id,p_user)
       and not exists(
         select 1 from public.event_media_exclusions x
          where x.event_id=e.id
            and x.uploader_id=v_author
            and x.excluded_user_id=p_user
       )
  ) then return true; end if;
  return exists(
    select 1 from public.audience_rules r
     where r.post_id=p_post and r.rule_type='include_friends'
  ) and public.is_friend(v_author,p_user);
end
$$;

create or replace function public.set_event_media_sharing_secure(
  p_event uuid,
  p_excluded_users uuid[]
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid();
  v_user uuid;
  v_role public.event_role;
  v_mode text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select role,participation_mode into v_role,v_mode
    from public.event_members
   where event_id=p_event and user_id=v_actor
   for update;
  if not found or v_role='viewer' or v_mode='view_only'
  then raise exception 'event sharing permission denied'; end if;
  if cardinality(coalesce(p_excluded_users,'{}'::uuid[]))>500
  then raise exception 'too many excluded members'; end if;

  foreach v_user in array coalesce(p_excluded_users,'{}'::uuid[]) loop
    if v_user is null or v_user=v_actor
       or not exists(
         select 1 from public.event_members
          where event_id=p_event and user_id=v_user
       )
    then raise exception 'invalid excluded event member'; end if;
  end loop;

  delete from public.event_media_exclusions
   where event_id=p_event and uploader_id=v_actor;
  insert into public.event_media_exclusions(event_id,uploader_id,excluded_user_id)
    select p_event,v_actor,x
      from unnest(coalesce(p_excluded_users,'{}'::uuid[])) x
     group by x;
  insert into public.feed_invalidations(user_id,reason)
    select em.user_id,'event_sharing'
      from public.event_members em
     where em.event_id=p_event and em.user_id<>v_actor;
  return true;
end
$$;

create or replace function public.emit_event_membership_invalidation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid:=coalesce(new.event_id,old.event_id);
begin
  insert into public.feed_invalidations(user_id,reason)
    select em.user_id,'event_membership'
      from public.event_members em
      join public.profiles p on p.id=em.user_id
     where em.event_id=v_event
    union
    select changed.user_id,'event_membership'
      from (values(coalesce(new.user_id,old.user_id))) changed(user_id)
      join public.profiles p on p.id=changed.user_id;
  return coalesce(new,old);
end
$$;
revoke all on function public.emit_event_membership_invalidation()
from public,anon,authenticated;
drop trigger if exists invalidate_feed_for_event_membership on public.event_members;
create trigger invalidate_feed_for_event_membership
after insert or update of role,participation_mode or delete on public.event_members
for each row execute function public.emit_event_membership_invalidation();

create or replace function public.set_post_downloads_secure(
  p_post uuid,
  p_allow_downloads boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.posts
     set allow_downloads=coalesce(p_allow_downloads,false),updated_at=now()
   where id=p_post and author_id=auth.uid()
  returning id into v_id;
  if v_id is null then raise exception 'post ownership required'; end if;
  return coalesce(p_allow_downloads,false);
end
$$;

create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb,
  p_location_name text,
  p_allow_downloads boolean
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid; v_subject uuid; v_item jsonb; v_order integer;
  v_rule public.audience_rule_type; v_upload_id uuid; v_upload public.media_uploads%rowtype;
  v_event_id uuid; v_event_role public.event_role; v_participation_mode text;
  v_location_name text:=nullif(btrim(coalesce(p_location_name,'')),'');
begin
  if auth.uid() is null
     or coalesce(char_length(p_caption),0)>220
     or p_audience not in ('private','friends','circles','events','people','except')
     or coalesce(char_length(v_location_name),0)>160
  then raise exception 'invalid post input'; end if;
  if jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array'
     or coalesce(jsonb_array_length(p_media),0)>8
  then raise exception 'invalid media'; end if;
  if p_audience in ('private','friends')
     and coalesce(cardinality(p_subject_ids),0)<>0
  then raise exception 'invalid audience subjects'; end if;
  if p_audience in ('circles','events','people','except')
     and coalesce(cardinality(p_subject_ids),0)=0
  then raise exception 'invalid audience subjects'; end if;
  if p_audience='events' then
    if cardinality(p_subject_ids)<>1
       or not public.can_view_event(p_subject_ids[1],auth.uid())
    then raise exception 'invalid event audience'; end if;
    v_event_id:=p_subject_ids[1];
    select role,participation_mode into v_event_role,v_participation_mode
      from public.event_members
     where event_id=v_event_id and user_id=auth.uid();
    if v_event_role is null or v_event_role='viewer' or v_participation_mode='view_only'
    then raise exception 'event posting permission denied'; end if;
    if v_participation_mode='upload_only'
       and coalesce(jsonb_array_length(p_media),0)=0
    then raise exception 'upload-only posts require media'; end if;
  end if;

  insert into public.posts(
    author_id,event_id,caption,audience_kind,location_name,allow_downloads
  ) values(
    auth.uid(),v_event_id,coalesce(p_caption,''),p_audience,v_location_name,
    coalesce(p_allow_downloads,false)
  ) returning id into v_id;
  if p_audience in ('friends','except') then
    insert into public.audience_rules(post_id,rule_type)
      values(v_id,'include_friends');
  end if;
  foreach v_subject in array coalesce(p_subject_ids,'{}'::uuid[]) loop
    v_rule:=case p_audience
      when 'people' then 'include_user'::public.audience_rule_type
      when 'except' then 'exclude_user'::public.audience_rule_type
      when 'circles' then 'include_circle'::public.audience_rule_type
      when 'events' then 'include_event'::public.audience_rule_type
    end;
    if not public.can_set_audience_rule(v_id,v_rule,v_subject,auth.uid())
    then raise exception 'invalid audience subject'; end if;
    insert into public.audience_rules(post_id,rule_type,subject_id)
      values(v_id,v_rule,v_subject);
  end loop;
  for v_item,v_order in
    select value,(ordinality-1)::integer
      from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) with ordinality
  loop
    begin
      v_upload_id:=(v_item->>'upload_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid media';
    end;
    select * into v_upload
      from public.media_uploads
     where id=v_upload_id and owner_id=auth.uid()
       and status='uploaded' and expires_at>now()
     for update;
    if not found then raise exception 'invalid media'; end if;
    insert into public.post_media(
      post_id,upload_id,object_key,media_type,width,height,duration_ms,sort_order
    ) values(
      v_id,v_upload.id,v_upload.object_key,v_upload.media_type,v_upload.width,
      v_upload.height,v_upload.duration_ms,v_order
    );
    update public.media_uploads
       set status='claimed',post_id=v_id,expires_at=now()+interval '100 years',
           updated_at=now()
     where id=v_upload.id;
  end loop;
  return v_id;
end
$$;

create or replace function public.unshare_event_post_secure(p_post uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_event uuid;
  v_author uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select event_id,author_id into v_event,v_author
    from public.posts where id=p_post for update;
  if v_author is null or v_author<>auth.uid() then raise exception 'post ownership required'; end if;
  if v_event is null then return false; end if;
  delete from public.audience_rules
   where post_id=p_post and rule_type='include_event' and subject_id=v_event;
  update public.posts
     set event_id=null,audience_kind='private',updated_at=now()
   where id=p_post;
  insert into public.feed_invalidations(user_id,reason)
    select em.user_id,'post_audience'
      from public.event_members em
     where em.event_id=v_event and em.user_id<>auth.uid();
  return true;
end
$$;

create or replace function public.update_post_secure(
  p_post uuid,
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_location_name text,
  p_allow_downloads boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_author uuid;
  v_existing_event uuid;
  v_event_id uuid;
  v_subject uuid;
  v_rule public.audience_rule_type;
  v_role public.event_role;
  v_mode text;
  v_location text:=nullif(btrim(coalesce(p_location_name,'')),'');
begin
  if auth.uid() is null
     or p_audience not in ('private','friends','circles','events','people','except')
     or coalesce(char_length(p_caption),0)>220
     or coalesce(char_length(v_location),0)>160
  then raise exception 'invalid post input'; end if;
  if p_audience in ('private','friends') and cardinality(coalesce(p_subject_ids,'{}'::uuid[]))<>0
  then raise exception 'invalid audience subjects'; end if;
  if p_audience in ('circles','events','people','except') and cardinality(coalesce(p_subject_ids,'{}'::uuid[]))=0
  then raise exception 'invalid audience subjects'; end if;

  select author_id,event_id into v_author,v_existing_event
    from public.posts where id=p_post for update;
  if v_author is null or v_author<>auth.uid() then raise exception 'post ownership required'; end if;

  if p_audience='events' then
    if cardinality(p_subject_ids)<>1 or not public.can_view_event(p_subject_ids[1],auth.uid())
    then raise exception 'invalid event audience'; end if;
    v_event_id:=p_subject_ids[1];
    select role,participation_mode into v_role,v_mode
      from public.event_members
     where event_id=v_event_id and user_id=auth.uid();
    if v_role is null or v_role='viewer' or v_mode='view_only'
    then raise exception 'event posting permission denied'; end if;
    if v_mode='upload_only' and not exists(select 1 from public.post_media where post_id=p_post)
    then raise exception 'upload-only posts require media'; end if;
  end if;

  update public.posts
     set caption=coalesce(p_caption,''),
         audience_kind=p_audience,
         event_id=v_event_id,
         location_name=v_location,
         allow_downloads=coalesce(p_allow_downloads,false),
         updated_at=now()
   where id=p_post;
  delete from public.audience_rules where post_id=p_post;
  if p_audience in ('friends','except') then
    insert into public.audience_rules(post_id,rule_type) values(p_post,'include_friends');
  end if;
  foreach v_subject in array coalesce(p_subject_ids,'{}'::uuid[]) loop
    v_rule:=case p_audience
      when 'people' then 'include_user'::public.audience_rule_type
      when 'except' then 'exclude_user'::public.audience_rule_type
      when 'circles' then 'include_circle'::public.audience_rule_type
      when 'events' then 'include_event'::public.audience_rule_type
    end;
    if not public.can_set_audience_rule(p_post,v_rule,v_subject,auth.uid())
    then raise exception 'invalid audience subject'; end if;
    insert into public.audience_rules(post_id,rule_type,subject_id)
      values(p_post,v_rule,v_subject);
  end loop;
  return true;
end
$$;

drop function if exists public.list_feed_page_secure(timestamptz,uuid,integer);
create function public.list_feed_page_secure(
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
) returns table(
  id uuid,
  author_id uuid,
  event_id uuid,
  caption text,
  audience_kind text,
  location_name text,
  allow_downloads boolean,
  created_at timestamptz
) language sql stable security definer set search_path=public,pg_temp as $$
  select
    p.id,p.author_id,p.event_id,p.caption,p.audience_kind,p.location_name,
    p.allow_downloads,p.created_at
  from public.posts p
  where auth.uid() is not null
    and public.can_view_post(p.id,auth.uid())
    and not public.is_blocked(p.author_id,auth.uid())
    and (
      p_before_created_at is null
      or (p.created_at,p.id)<(
        p_before_created_at,
        coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
      )
    )
  order by p.created_at desc,p.id desc
  limit least(greatest(coalesce(p_limit,10),1),100)+1
$$;

revoke all on function public.set_event_media_sharing_secure(uuid,uuid[]),
  public.set_post_downloads_secure(uuid,boolean),
  public.create_post_secure(text,text,uuid[],jsonb),
  public.create_post_secure(text,text,uuid[],jsonb,text),
  public.create_post_secure(text,text,uuid[],jsonb,text,boolean),
  public.unshare_event_post_secure(uuid),
  public.update_post_secure(uuid,text,text,uuid[],text,boolean)
from public,anon,authenticated;
revoke all on function public.list_feed_page_secure(timestamptz,uuid,integer)
from public,anon,authenticated;
grant execute on function public.set_event_media_sharing_secure(uuid,uuid[]),
  public.set_post_downloads_secure(uuid,boolean),
  public.create_post_secure(text,text,uuid[],jsonb,text,boolean),
  public.unshare_event_post_secure(uuid),
  public.update_post_secure(uuid,text,text,uuid[],text,boolean)
to authenticated;
grant execute on function public.list_feed_page_secure(timestamptz,uuid,integer)
to authenticated;

-- Post and audience mutations are RPC-only. The legacy author policies remain
-- useful as defense in depth, but table privileges cannot bypass event posting
-- and ownership checks in the secure functions.
revoke update on public.posts from authenticated;
grant insert,delete on public.posts to authenticated;
revoke insert,update,delete on public.audience_rules from authenticated;
