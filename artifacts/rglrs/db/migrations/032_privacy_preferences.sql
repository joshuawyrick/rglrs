-- Account privacy is evaluated on the server. Blocks and explicit denials
-- always win; post/event-media exclusions remain their existing mechanisms.

create table public.privacy_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  default_post_audience_kind text not null default 'friends' check(default_post_audience_kind in ('private','friends','circles','events','people','except')),
  default_event_media_audience text not null default 'all_event_members' check(default_event_media_audience in ('all_event_members','event_members_except')),
  default_media_downloads boolean not null default false,
  allow_internal_resharing boolean not null default false,
  full_profile_visibility text not null default 'everyone' check(full_profile_visibility in ('everyone','friends','only_me')),
  profile_photo_visibility text not null default 'everyone' check(profile_photo_visibility in ('everyone','friends','only_me')),
  connections_visibility text not null default 'friends' check(connections_visibility in ('everyone','friends','only_me')),
  username_discoverability text not null default 'everyone' check(username_discoverability in ('everyone','friends','nobody')),
  email_discoverability text not null default 'nobody' check(email_discoverability in ('friends','nobody')),
  friend_request_policy text not null default 'everyone' check(friend_request_policy in ('everyone','nobody')),
  message_policy text not null default 'friends' check(message_policy in ('friends','nobody')),
  event_invite_policy text not null default 'friends' check(event_invite_policy in ('everyone','friends','nobody')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.privacy_default_audience_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check(scope in ('post','event_media')),
  rule_type public.audience_rule_type not null,
  subject_id uuid,
  created_at timestamptz not null default now(),
  check((rule_type='include_friends' and subject_id is null) or (rule_type<>'include_friends' and subject_id is not null))
);
create unique index privacy_default_audience_rules_unique
  on public.privacy_default_audience_rules(user_id,scope,rule_type,subject_id) nulls not distinct;

create table public.person_privacy_overrides (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  person_id uuid not null references public.profiles(id) on delete cascade,
  can_view_profile boolean,
  can_view_profile_photo boolean,
  can_view_connections boolean,
  can_find_username boolean,
  can_find_email boolean,
  can_send_friend_request boolean,
  can_message boolean,
  can_invite_to_events boolean,
  can_download_media boolean,
  can_reshare_internal boolean,
  hide_posts boolean,
  hide_event_media boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,person_id),
  check(owner_id<>person_id)
);
create index person_privacy_overrides_person_idx on public.person_privacy_overrides(person_id,owner_id);

alter table public.privacy_settings enable row level security;
alter table public.privacy_default_audience_rules enable row level security;
alter table public.person_privacy_overrides enable row level security;
revoke all on public.privacy_settings,public.privacy_default_audience_rules,public.person_privacy_overrides from public,anon,authenticated;
grant select on public.privacy_settings,public.privacy_default_audience_rules,public.person_privacy_overrides to authenticated;
create policy "owners read privacy settings" on public.privacy_settings
  for select to authenticated using(user_id=auth.uid());
create policy "owners read privacy default rules" on public.privacy_default_audience_rules
  for select to authenticated using(user_id=auth.uid());
create policy "owners read person privacy overrides" on public.person_privacy_overrides
  for select to authenticated using(owner_id=auth.uid());
insert into public.privacy_settings(user_id) select id from public.profiles;

alter table public.posts
  add column shared_from_post_id uuid references public.posts(id) on delete set null;
create index posts_shared_from_idx on public.posts(shared_from_post_id)
  where shared_from_post_id is not null;

create or replace function public.create_privacy_settings()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.privacy_settings(user_id) values(new.id) on conflict do nothing; return new; end $$;
create trigger create_profile_privacy_settings after insert on public.profiles
for each row execute function public.create_privacy_settings();

create or replace function public.privacy_allows(p_owner uuid,p_person uuid,p_field text)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_setting text; v_override text; v_boolean boolean;
begin
  if p_owner is null or p_person is null then return false; end if;
  if p_owner=p_person then return true; end if;
  if public.is_blocked(p_owner,p_person) then return false; end if;
  if p_field not in ('full_profile_visibility','profile_photo_visibility','connections_visibility','username_discoverability','email_discoverability','friend_request_policy','message_policy','event_invite_policy','can_download_media','allow_internal_resharing','hide_posts','hide_event_media') then return false; end if;
  select case p_field when 'full_profile_visibility' then can_view_profile when 'profile_photo_visibility' then can_view_profile_photo when 'connections_visibility' then can_view_connections when 'username_discoverability' then can_find_username when 'email_discoverability' then can_find_email when 'friend_request_policy' then can_send_friend_request when 'message_policy' then can_message when 'event_invite_policy' then can_invite_to_events when 'can_download_media' then can_download_media when 'allow_internal_resharing' then can_reshare_internal when 'hide_posts' then hide_posts when 'hide_event_media' then hide_event_media end::text into v_override from public.person_privacy_overrides where owner_id=p_owner and person_id=p_person;
  if p_field in ('hide_posts','hide_event_media') then return coalesce(v_override,'false')<>'true'; end if;
  -- A specific private/nobody/false choice is a denial, never an overrideable grant.
  if v_override='false' then return false; end if;
  if p_field='can_download_media' then p_field:='default_media_downloads'; end if;
  execute format('select %I::text from public.privacy_settings where user_id=$1',p_field)
    into v_setting using p_owner;
  if v_setting in ('only_me','nobody','false') then return false; end if;
  if v_override in ('everyone','allow','true') then return true; end if;
  if p_field='message_policy' then return coalesce(v_setting,'friends')='friends' and public.is_friend(p_owner,p_person); end if;
  if p_field='friend_request_policy' then
    return v_setting='everyone';
  end if;
  if p_field='event_invite_policy' then return coalesce(v_setting,'friends')='everyone' or public.is_friend(p_owner,p_person); end if;
  if p_field='allow_internal_resharing' then return coalesce(v_setting,'false')='true'; end if;
  return v_setting='everyone' or (v_setting='friends' and public.is_friend(p_owner,p_person));
end $$;

create or replace function public.can_view_post(p_post uuid,p_user uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_author uuid; v_event uuid;
begin
 select author_id,event_id into v_author,v_event from public.posts where id=p_post;
 if v_author is null then return false; end if;
 if v_author=p_user then return true; end if;
 if public.is_blocked(v_author,p_user) or not public.privacy_allows(v_author,p_user,'hide_posts') then return false; end if;
 if v_event is not null and (not public.can_view_event(v_event,p_user) or not public.privacy_allows(v_author,p_user,'hide_event_media') or exists(select 1 from public.event_media_exclusions x where x.event_id=v_event and x.uploader_id=v_author and x.excluded_user_id=p_user)) then return false; end if;
 if exists(select 1 from public.audience_rules r where r.post_id=p_post and r.rule_type='exclude_user' and r.subject_id=p_user) then return false; end if;
 if exists(select 1 from public.audience_rules r where r.post_id=p_post and r.rule_type='include_user' and r.subject_id=p_user) then return true; end if;
 if exists(select 1 from public.audience_rules r join public.circles c on c.id=r.subject_id where r.post_id=p_post and r.rule_type='include_circle' and public.can_view_circle(c.id,p_user)) then return true; end if;
 if exists(select 1 from public.audience_rules r join public.events e on e.id=r.subject_id where r.post_id=p_post and r.rule_type='include_event' and public.can_view_event(e.id,p_user) and not exists(select 1 from public.event_media_exclusions x where x.event_id=e.id and x.uploader_id=v_author and x.excluded_user_id=p_user)) then return true; end if;
 return exists(select 1 from public.audience_rules r where r.post_id=p_post and r.rule_type='include_friends') and public.is_friend(v_author,p_user);
end $$;

drop policy if exists "profiles readable unless blocked" on public.profiles;
drop policy if exists "profiles readable by privacy settings" on public.profiles;
create policy "profiles readable by privacy settings" on public.profiles for select to authenticated using(public.privacy_allows(id,auth.uid(),'full_profile_visibility'));

create or replace function public.is_conversation_member(p_conversation uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.conversation_members me where me.conversation_id=p_conversation and me.user_id=p_user)
 and not exists(
   select 1 from public.conversation_members a join public.conversation_members b
     on b.conversation_id=a.conversation_id and a.user_id<b.user_id
    where a.conversation_id=p_conversation
      and (not public.privacy_allows(a.user_id,b.user_id,'message_policy')
        or not public.privacy_allows(b.user_id,a.user_id,'message_policy'))
 ) $$;

create or replace function public.search_profiles(p_query text) returns table(id uuid,display_name text,username text)
language sql stable security definer set search_path=public,pg_temp as $$
 select p.id,p.display_name,p.username from public.profiles p where auth.uid() is not null and p.id<>auth.uid()
  and public.privacy_allows(p.id,auth.uid(),'full_profile_visibility')
  and public.privacy_allows(p.id,auth.uid(),'username_discoverability')
  and char_length(trim(p_query)) between 2 and 60 and (p.display_name ilike '%'||trim(p_query)||'%' or p.username ilike '%'||trim(p_query)||'%') order by p.display_name limit 20 $$;

create or replace function public.create_friend_request_secure(p_addressee uuid) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_row public.friendships%rowtype;
begin
 if v_actor is null or p_addressee is null or p_addressee=v_actor or not exists(select 1 from public.profiles where id=p_addressee) or not public.privacy_allows(p_addressee,v_actor,'friend_request_policy') then raise exception 'invalid friend request'; end if;
 perform private.enforce_write_rate(v_actor,'friendships',30); perform pg_advisory_xact_lock(hashtextextended(least(v_actor::text,p_addressee::text)||greatest(v_actor::text,p_addressee::text),0));
 select * into v_row from public.friendships where least(requester_id,addressee_id)=least(v_actor,p_addressee) and greatest(requester_id,addressee_id)=greatest(v_actor,p_addressee) for update;
 if found and v_row.status in ('accepted','pending') then return v_row.id; end if;
 if found then update public.friendships set requester_id=v_actor,addressee_id=p_addressee,status='pending',updated_at=now() where id=v_row.id returning id into v_row.id; return v_row.id; end if;
 insert into public.friendships(requester_id,addressee_id,status) values(v_actor,p_addressee,'pending') returning id into v_row.id; return v_row.id;
end $$;

create or replace function public.get_privacy_settings_secure() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('settings',to_jsonb(s)-'user_id'-'created_at'-'updated_at','default_rules',coalesce((select jsonb_agg(jsonb_build_object('scope',r.scope,'rule_type',r.rule_type,'subject_id',r.subject_id)) from public.privacy_default_audience_rules r where r.user_id=auth.uid()),'[]'::jsonb),'person_overrides',coalesce((select jsonb_agg(to_jsonb(o)-'owner_id'-'created_at'-'updated_at') from public.person_privacy_overrides o where o.owner_id=auth.uid()),'[]'::jsonb))
 from public.privacy_settings s where s.user_id=auth.uid() $$;

create or replace function public.set_privacy_settings_secure(p_settings jsonb,p_default_rules jsonb,p_person_overrides jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v jsonb; v_subject uuid;
begin
 if v_actor is null or jsonb_typeof(p_settings)<>'object' or jsonb_typeof(coalesce(p_default_rules,'[]'))<>'array' or jsonb_typeof(coalesce(p_person_overrides,'[]'))<>'array' or jsonb_array_length(coalesce(p_default_rules,'[]'))>500 or jsonb_array_length(coalesce(p_person_overrides,'[]'))>500 then raise exception 'invalid privacy settings'; end if;
 insert into public.privacy_settings(user_id,default_post_audience_kind,default_event_media_audience,default_media_downloads,allow_internal_resharing,full_profile_visibility,profile_photo_visibility,connections_visibility,username_discoverability,email_discoverability,friend_request_policy,message_policy,event_invite_policy,updated_at)
 values(v_actor,p_settings->>'default_post_audience_kind',p_settings->>'default_event_media_audience',(p_settings->>'default_media_downloads')::boolean,(p_settings->>'allow_internal_resharing')::boolean,p_settings->>'full_profile_visibility',p_settings->>'profile_photo_visibility',p_settings->>'connections_visibility',p_settings->>'username_discoverability',p_settings->>'email_discoverability',p_settings->>'friend_request_policy',p_settings->>'message_policy',p_settings->>'event_invite_policy',now())
 on conflict(user_id) do update set default_post_audience_kind=excluded.default_post_audience_kind,default_event_media_audience=excluded.default_event_media_audience,default_media_downloads=excluded.default_media_downloads,allow_internal_resharing=excluded.allow_internal_resharing,full_profile_visibility=excluded.full_profile_visibility,profile_photo_visibility=excluded.profile_photo_visibility,connections_visibility=excluded.connections_visibility,username_discoverability=excluded.username_discoverability,email_discoverability=excluded.email_discoverability,friend_request_policy=excluded.friend_request_policy,message_policy=excluded.message_policy,event_invite_policy=excluded.event_invite_policy,updated_at=now();
 delete from public.privacy_default_audience_rules where user_id=v_actor;
 for v in select value from jsonb_array_elements(coalesce(p_default_rules,'[]')) loop
  begin v_subject:=nullif(v->>'subject_id','')::uuid; exception when invalid_text_representation then raise exception 'invalid privacy rule'; end;
  if v->>'scope' not in ('post','event_media') or v->>'rule_type' not in ('include_friends','include_circle','include_event','include_user','exclude_user') or ((v->>'rule_type'='include_friends')<>(v_subject is null)) then raise exception 'invalid privacy rule'; end if;
  insert into public.privacy_default_audience_rules(user_id,scope,rule_type,subject_id) values(v_actor,v->>'scope',(v->>'rule_type')::public.audience_rule_type,v_subject);
 end loop;
 delete from public.person_privacy_overrides where owner_id=v_actor;
 for v in select value from jsonb_array_elements(coalesce(p_person_overrides,'[]')) loop
  begin v_subject:=(v->>'person_id')::uuid; exception when invalid_text_representation then raise exception 'invalid person override'; end;
  if v_subject is null or v_subject=v_actor or not exists(select 1 from public.profiles where id=v_subject) then raise exception 'invalid person override'; end if;
  insert into public.person_privacy_overrides(owner_id,person_id,can_view_profile,can_view_profile_photo,can_view_connections,can_find_username,can_find_email,can_send_friend_request,can_message,can_invite_to_events,can_download_media,can_reshare_internal,hide_posts,hide_event_media)
  values(v_actor,v_subject,(v->>'can_view_profile')::boolean,(v->>'can_view_profile_photo')::boolean,(v->>'can_view_connections')::boolean,(v->>'can_find_username')::boolean,(v->>'can_find_email')::boolean,(v->>'can_send_friend_request')::boolean,(v->>'can_message')::boolean,(v->>'can_invite_to_events')::boolean,(v->>'can_download_media')::boolean,(v->>'can_reshare_internal')::boolean,(v->>'hide_posts')::boolean,(v->>'hide_event_media')::boolean);
 end loop; return true;
end $$;

create function public.update_privacy_settings_secure(p_settings jsonb) returns boolean
language sql security definer set search_path=public,pg_temp as $$
  select public.set_privacy_settings_secure(
    p_settings,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'scope',r.scope,'rule_type',r.rule_type,'subject_id',r.subject_id
      ) order by r.scope,r.rule_type,r.subject_id)
      from public.privacy_default_audience_rules r where r.user_id=auth.uid()
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(o)-'owner_id'-'created_at'-'updated_at' order by o.person_id)
      from public.person_privacy_overrides o where o.owner_id=auth.uid()
    ),'[]'::jsonb)
  )
$$;
create function public.set_privacy_default_audience_rules_secure(p_rules jsonb) returns boolean
language sql security definer set search_path=public,pg_temp as $$
  select public.set_privacy_settings_secure(
    to_jsonb(s)-'user_id'-'created_at'-'updated_at',
    p_rules,
    coalesce((
      select jsonb_agg(to_jsonb(o)-'owner_id'-'created_at'-'updated_at' order by o.person_id)
      from public.person_privacy_overrides o where o.owner_id=auth.uid()
    ),'[]'::jsonb)
  )
  from public.privacy_settings s where s.user_id=auth.uid()
$$;
create function public.set_person_privacy_override_secure(p_override jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_person uuid;
begin
  if v_actor is null or jsonb_typeof(p_override)<>'object' then raise exception 'invalid person override'; end if;
  begin v_person:=(p_override->>'person_id')::uuid;
  exception when invalid_text_representation then raise exception 'invalid person override'; end;
  if v_person is null or v_person=v_actor or not exists(select 1 from public.profiles where id=v_person)
  then raise exception 'invalid person override'; end if;
  insert into public.person_privacy_overrides(
    owner_id,person_id,can_view_profile,can_view_profile_photo,can_view_connections,
    can_find_username,can_find_email,can_send_friend_request,can_message,
    can_invite_to_events,can_download_media,can_reshare_internal,hide_posts,hide_event_media
  ) values(
    v_actor,v_person,(p_override->>'can_view_profile')::boolean,
    (p_override->>'can_view_profile_photo')::boolean,(p_override->>'can_view_connections')::boolean,
    (p_override->>'can_find_username')::boolean,(p_override->>'can_find_email')::boolean,
    (p_override->>'can_send_friend_request')::boolean,(p_override->>'can_message')::boolean,
    (p_override->>'can_invite_to_events')::boolean,(p_override->>'can_download_media')::boolean,
    (p_override->>'can_reshare_internal')::boolean,(p_override->>'hide_posts')::boolean,
    (p_override->>'hide_event_media')::boolean
  )
  on conflict(owner_id,person_id) do update set
    can_view_profile=excluded.can_view_profile,
    can_view_profile_photo=excluded.can_view_profile_photo,
    can_view_connections=excluded.can_view_connections,
    can_find_username=excluded.can_find_username,
    can_find_email=excluded.can_find_email,
    can_send_friend_request=excluded.can_send_friend_request,
    can_message=excluded.can_message,
    can_invite_to_events=excluded.can_invite_to_events,
    can_download_media=excluded.can_download_media,
    can_reshare_internal=excluded.can_reshare_internal,
    hide_posts=excluded.hide_posts,
    hide_event_media=excluded.hide_event_media,
    updated_at=now();
  return true;
end $$;
create function public.remove_person_privacy_override_secure(p_person uuid) returns boolean language sql security definer set search_path=public,pg_temp as $$
 delete from public.person_privacy_overrides where owner_id=auth.uid() and person_id=p_person returning true $$;
create function public.can_view_profile(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'full_profile_visibility') $$;
create function public.can_view_profile_photo(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'profile_photo_visibility') $$;
create function public.can_view_connections(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'connections_visibility') $$;
create function public.can_find_username(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'username_discoverability') $$;
create function public.can_find_email(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'email_discoverability') $$;
create function public.can_send_friend_request(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'friend_request_policy') $$;
create function public.can_message(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'message_policy') $$;
create function public.can_invite_to_events(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'event_invite_policy') $$;
create function public.can_download_media(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'can_download_media') $$;
create function public.can_reshare_profile_content(p_owner uuid,p_person uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$ select public.privacy_allows(p_owner,p_person,'allow_internal_resharing') $$;

create function public.list_profile_connections_secure(p_profile uuid)
returns table(id uuid,display_name text,username text,avatar_key text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or p_profile is null then raise exception 'authentication required'; end if;
  if v_actor<>p_profile and (
    not public.can_view_profile(p_profile,v_actor)
    or not public.can_view_connections(p_profile,v_actor)
  ) then return; end if;
  return query
    select p.id,p.display_name,p.username,
      case when public.can_view_profile_photo(p.id,v_actor) then p.avatar_key else null end
      from public.friendships f
      join public.profiles p on p.id=case when f.requester_id=p_profile then f.addressee_id else f.requester_id end
     where f.status='accepted'
       and p_profile in (f.requester_id,f.addressee_id)
       and not public.is_blocked(p_profile,p.id)
       and not public.is_blocked(v_actor,p.id)
       and public.can_view_profile(p.id,v_actor)
     order by p.display_name,p.id
     limit 500;
end $$;

create function public.reshare_post_secure(p_post uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_author uuid; v_event uuid; v_id uuid;
begin
  if v_actor is null or p_post is null then raise exception 'authentication required'; end if;
  select author_id,event_id into v_author,v_event from public.posts where id=p_post for share;
  if v_author is null or v_author=v_actor
     or not public.can_view_post(p_post,v_actor)
     or not public.can_reshare_profile_content(v_author,v_actor)
     or (v_event is not null and not public.can_view_event(v_event,v_actor))
  then raise exception 'post cannot be reshared'; end if;
  insert into public.posts(author_id,caption,audience_kind,allow_downloads,shared_from_post_id)
    values(v_actor,'','friends',false,p_post) returning id into v_id;
  insert into public.audience_rules(post_id,rule_type) values(v_id,'include_friends');
  return v_id;
end $$;

-- Preserve the legacy direct/group conversation contract while applying the
-- recipient's deny-wins message policy before an existing/new direct thread
-- can be returned.
create or replace function public.create_conversation_secure(p_participant_ids uuid[],p_title text)
returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_members uuid[]; v_member uuid; v_id uuid;
  v_count integer; v_key text; v_left uuid; v_right uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select array_agg(x order by x) into v_members
    from (select distinct unnest(coalesce(p_participant_ids,'{}'::uuid[])||array[v_actor]) x) s;
  v_count:=coalesce(cardinality(v_members),0);
  if v_count<2 or v_count>32 then raise exception 'conversation requires 2 to 32 participants'; end if;
  if v_count=2 and nullif(trim(coalesce(p_title,'')),'') is not null then
    raise exception 'direct conversations cannot have a title';
  end if;
  if v_count>2 and char_length(trim(coalesce(p_title,''))) not between 1 and 120 then
    raise exception 'group title required';
  end if;
  foreach v_member in array v_members loop
    if v_member<>v_actor and (
      not exists(select 1 from public.profiles where id=v_member)
      or not public.is_friend(v_actor,v_member)
      or public.is_blocked(v_actor,v_member)
    ) then raise exception 'ineligible conversation participant'; end if;
  end loop;
  if v_count=2 then
    select x into v_member from unnest(v_members) x where x<>v_actor;
    if not public.privacy_allows(v_member,v_actor,'message_policy') then
      raise exception 'recipient does not allow messages';
    end if;
  end if;
  for v_left,v_right in
    select l.member_id,r.member_id
      from unnest(v_members) as l(member_id) cross join unnest(v_members) as r(member_id)
     where l.member_id<r.member_id order by l.member_id,r.member_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_left::text||':'||v_right::text,0));
  end loop;
  if exists(
    select 1 from unnest(v_members) as l(member_id) cross join unnest(v_members) as r(member_id)
     where l.member_id<r.member_id and public.is_blocked(l.member_id,r.member_id)
  ) then raise exception 'blocked conversation participant'; end if;
  if v_count=2 then
    v_key:=v_members[1]::text||':'||v_members[2]::text;
    select c.id into v_id from public.conversations c where c.direct_key=v_key for update;
    if v_id is null then
      select c.id into v_id
        from public.conversations c
       where not c.is_group
         and (select array_agg(cm.user_id order by cm.user_id) from public.conversation_members cm where cm.conversation_id=c.id)=v_members
       order by c.created_at,c.id limit 1 for update;
      if v_id is not null then update public.conversations set direct_key=v_key where id=v_id; end if;
    end if;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.conversations(title,is_group,created_by,direct_key)
  values(case when v_count>2 then trim(p_title) end,v_count>2,v_actor,v_key) returning id into v_id;
  insert into public.conversation_members(conversation_id,user_id,last_read_at)
    select v_id,x,case when x=v_actor then now() end from unnest(v_members) x;
  return v_id;
end $$;

create or replace function public.redeem_event_invite_secure(p_token_hash text,p_pin text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_inv public.invites%rowtype; v_owner uuid; v_role public.event_role; v_mode text; v_event uuid;
 v_window timestamptz:=date_bin(interval '15 minutes',now(),timestamptz '2000-01-01'); v_attempts integer;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 select event_id into v_event from public.invites where token_hash=p_token_hash;
 if v_event is null then return null; end if;
 perform 1 from public.events where id=v_event for update;
 select * into v_inv from public.invites where token_hash=p_token_hash and event_id=v_event for update;
 if not found then return null; end if;
 if exists(select 1 from public.event_invite_redemptions where invite_id=v_inv.id and user_id=auth.uid()) then
  delete from private.invite_pin_attempts where actor_id=auth.uid() and invite_id=v_inv.id; return v_inv.event_id;
 end if;
 if v_inv.revoked_at is not null or v_inv.expires_at is null or v_inv.expires_at<=now()
   or (v_inv.max_uses is not null and v_inv.use_count>=v_inv.max_uses) then return null; end if;
 select owner_id into v_owner from public.events where id=v_event;
 if v_owner is null or public.is_blocked(v_owner,auth.uid()) or public.is_blocked(v_inv.created_by,auth.uid())
   or not public.privacy_allows(auth.uid(),v_inv.created_by,'event_invite_policy') then return null; end if;
 if v_inv.pin_hash is not null then
  select attempts into v_attempts from private.invite_pin_attempts where actor_id=auth.uid() and invite_id=v_inv.id and window_started=v_window;
  if coalesce(v_attempts,0)>=5 then return null; end if;
  if p_pin is null or extensions.crypt(p_pin,v_inv.pin_hash)<>v_inv.pin_hash then
   insert into private.invite_pin_attempts(actor_id,invite_id,window_started,attempts) values(auth.uid(),v_inv.id,v_window,1)
    on conflict(actor_id,invite_id,window_started) do update set attempts=least(private.invite_pin_attempts.attempts+1,5),updated_at=now();
   return null;
  end if;
  delete from private.invite_pin_attempts where actor_id=auth.uid() and invite_id=v_inv.id;
 end if;
 if v_inv.mode='approval' then
  insert into public.event_invite_redemptions(invite_id,user_id,status) values(v_inv.id,auth.uid(),'pending');
 else
  v_role:=case when v_inv.mode='view_only' then 'viewer'::public.event_role else 'member'::public.event_role end; v_mode:=v_inv.mode;
  insert into public.event_members(event_id,user_id,role,participation_mode) values(v_event,auth.uid(),v_role,v_mode)
   on conflict(event_id,user_id) do update set
    role=case when public.event_members.role in ('owner','admin') then public.event_members.role else excluded.role end,
    participation_mode=case when public.event_members.role in ('owner','admin') then 'participate' else excluded.participation_mode end;
  insert into public.event_invite_redemptions(invite_id,user_id,status,decided_at) values(v_inv.id,auth.uid(),'accepted',now());
 end if;
 update public.invites set use_count=use_count+1 where id=v_inv.id;
 return v_event;
end $$;

create or replace function public.decide_event_invite_redemption_secure(p_invite uuid,p_user uuid,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_event uuid; v_mode text; v_owner uuid; v_creator uuid; v_status text; v_role public.event_role; v_participation text;
begin
 if auth.uid() is null or p_invite is null or p_user is null or p_accept is null then raise exception 'invalid invite decision'; end if;
 select event_id into v_event from public.invites where id=p_invite;
 if v_event is null then raise exception 'event administrator required'; end if;
 select owner_id into v_owner from public.events where id=v_event for update;
  if v_owner is null or not exists(
    select 1 from public.event_members admin
     where admin.event_id=v_event and admin.user_id=auth.uid() and admin.role in ('owner','admin')
  )
 then raise exception 'event administrator required'; end if;
 select mode,created_by into v_mode,v_creator from public.invites where id=p_invite and event_id=v_event for update;
 if v_mode is null then raise exception 'event administrator required'; end if;
 select status into v_status from public.event_invite_redemptions where invite_id=p_invite and user_id=p_user for update;
 if v_status is distinct from 'pending' then return false; end if;
 if p_accept then
  if not exists(select 1 from public.invites i where i.id=p_invite and i.revoked_at is null and i.expires_at>now()
       and i.use_count>0 and (i.max_uses is null or i.use_count<=i.max_uses))
    or public.is_blocked(v_owner,p_user) or public.is_blocked(v_creator,p_user)
    or not public.privacy_allows(p_user,v_creator,'event_invite_policy')
  then return false; end if;
  v_role:=case when v_mode='view_only' then 'viewer'::public.event_role else 'member'::public.event_role end;
  v_participation:=case when v_mode in ('participate','upload_only','view_only') then v_mode else 'participate' end;
  insert into public.event_members(event_id,user_id,role,participation_mode) values(v_event,p_user,v_role,v_participation)
   on conflict(event_id,user_id) do update set
    role=case when public.event_members.role in ('owner','admin') then public.event_members.role else excluded.role end,
    participation_mode=case when public.event_members.role in ('owner','admin') then 'participate' else excluded.participation_mode end;
 end if;
 update public.event_invite_redemptions set status=case when p_accept then 'accepted' else 'declined' end,
  decided_at=now(),decided_by=auth.uid() where invite_id=p_invite and user_id=p_user and status='pending';
 return found;
end $$;

-- Keep the migration-031 seven-argument API, but resolve an omitted audience
-- server-side so clients cannot choose a more permissive default by omission.
create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb,
  p_location_name text,
  p_location_address text,
  p_allow_downloads boolean
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_audience text:=p_audience;
  v_subject_ids uuid[]:=p_subject_ids;
  v_allow_downloads boolean:=p_allow_downloads;
  v_default_downloads boolean;
  v_location_address text:=nullif(btrim(coalesce(p_location_address,'')),'');
  v_default_event_media text;
begin
  if auth.uid() is null or coalesce(char_length(v_location_address),0)>240 then
    raise exception 'invalid post input';
  end if;

  select default_media_downloads,default_event_media_audience
    into v_default_downloads,v_default_event_media
    from public.privacy_settings where user_id=auth.uid();
  if v_allow_downloads is null then v_allow_downloads:=v_default_downloads; end if;

  if v_audience is null then
    select default_post_audience_kind into v_audience
      from public.privacy_settings where user_id=auth.uid();
    if v_audience is null then raise exception 'privacy settings unavailable'; end if;
    if v_audience in ('private','friends') then
      v_subject_ids:='{}'::uuid[];
    else
      select coalesce(array_agg(r.subject_id order by r.subject_id), '{}'::uuid[])
        into v_subject_ids
        from public.privacy_default_audience_rules r
       where r.user_id=auth.uid()
         and r.scope='post'
         and r.rule_type=case v_audience
           when 'circles' then 'include_circle'::public.audience_rule_type
           when 'events' then 'include_event'::public.audience_rule_type
           when 'people' then 'include_user'::public.audience_rule_type
           when 'except' then 'exclude_user'::public.audience_rule_type
         end;
    end if;
  end if;
  v_allow_downloads:=coalesce(v_allow_downloads,false);

  v_id:=public.create_post_secure(
    p_caption,v_audience,v_subject_ids,p_media,p_location_name,v_allow_downloads
  );
  update public.posts
     set location_address=v_location_address
   where id=v_id and author_id=auth.uid();

  -- Reuse the event-media exclusion mechanism. Only an omitted audience uses
  -- this saved template; explicit event sharing stays exactly as submitted.
  if p_audience is null and v_audience='events'
     and v_default_event_media='event_members_except' then
    insert into public.event_media_exclusions(event_id,uploader_id,excluded_user_id)
      select p.event_id,auth.uid(),r.subject_id
        from public.posts p
        join public.privacy_default_audience_rules r
          on r.user_id=auth.uid()
         and r.scope='event_media'
         and r.rule_type='exclude_user'
        join public.event_members em
          on em.event_id=p.event_id and em.user_id=r.subject_id
       where p.id=v_id
         and r.subject_id<>auth.uid()
      on conflict do nothing;
  end if;
  return v_id;
end
$$;

revoke all on function public.create_privacy_settings(),public.privacy_allows(uuid,uuid,text),public.get_privacy_settings_secure(),public.set_privacy_settings_secure(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.privacy_allows(uuid,uuid,text),public.get_privacy_settings_secure(),public.set_privacy_settings_secure(jsonb,jsonb,jsonb),public.search_profiles(text),public.create_friend_request_secure(uuid) to authenticated;
grant execute on function public.update_privacy_settings_secure(jsonb),public.set_privacy_default_audience_rules_secure(jsonb),public.set_person_privacy_override_secure(jsonb),public.remove_person_privacy_override_secure(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid,uuid),public.can_view_profile_photo(uuid,uuid),public.can_view_connections(uuid,uuid),public.can_find_username(uuid,uuid),public.can_find_email(uuid,uuid),public.can_send_friend_request(uuid,uuid),public.can_message(uuid,uuid),public.can_invite_to_events(uuid,uuid),public.can_download_media(uuid,uuid),public.can_reshare_profile_content(uuid,uuid) to authenticated;
revoke all on function public.list_profile_connections_secure(uuid),public.reshare_post_secure(uuid) from public,anon,authenticated;
grant execute on function public.list_profile_connections_secure(uuid),public.reshare_post_secure(uuid) to authenticated;
revoke all on function public.redeem_event_invite_secure(text,text),public.decide_event_invite_redemption_secure(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.redeem_event_invite_secure(text,text),public.decide_event_invite_redemption_secure(uuid,uuid,boolean) to authenticated;
revoke all on function public.create_conversation_secure(uuid[],text) from public,anon,authenticated;
grant execute on function public.create_conversation_secure(uuid[],text) to authenticated;
revoke all on function public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean) from public,anon,authenticated;
grant execute on function public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean) to authenticated;

insert into public.rglrs_migrations(version,filename) values(32,'032_privacy_preferences.sql') on conflict(version) do update set filename=excluded.filename;