-- RGLRS v0.1 relational + privacy foundation
-- Run in Supabase SQL Editor on a new project.

create extension if not exists pgcrypto;

create type public.friendship_status as enum ('pending','accepted','declined','blocked');
create type public.event_role as enum ('owner','admin','member','viewer');
create type public.audience_rule_type as enum ('include_user','include_circle','include_event','include_friends','exclude_user');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null,
  bio text default '',
  avatar_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_friendship check (requester_id <> addressee_id),
  constraint unique_friendship unique (requester_id, addressee_id)
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  emoji text,
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 140),
  description text default '',
  starts_at timestamptz,
  ends_at timestamptz,
  place_name text,
  cover_key text,
  members_can_invite boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.event_members (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.event_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  caption text default '',
  audience_kind text not null default 'private' check (audience_kind in ('private','friends','circles','events','people','except')),
  comments_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  object_key text not null,
  media_type text not null check (media_type in ('image','video')),
  width int,
  height int,
  duration_ms int,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.audience_rules (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  rule_type public.audience_rule_type not null,
  subject_id uuid,
  created_at timestamptz not null default now()
);
create index audience_rules_post_idx on public.audience_rules(post_id);
create index posts_author_created_idx on public.posts(author_id, created_at desc);
create index posts_event_created_idx on public.posts(event_id, created_at desc);
create index posts_created_idx on public.posts(created_at desc, id desc);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create table public.reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index saves_user_created_idx on public.saves(user_id, created_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  is_group boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  ciphertext text not null,
  client_message_id uuid,
  created_at timestamptz not null default now()
);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  mode text not null check (mode in ('participate','upload_only','view_only','approval')),
  pin_hash text,
  expires_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Helper functions. SECURITY DEFINER keeps policies readable and prevents recursive RLS.
create or replace function public.is_friend(a uuid, b uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from friendships f
    where f.status='accepted' and ((f.requester_id=a and f.addressee_id=b) or (f.requester_id=b and f.addressee_id=a))
  );
$$;

create or replace function public.can_view_event(p_event uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from events e where e.id=p_event and e.owner_id=p_user)
  or exists(select 1 from event_members em where em.event_id=p_event and em.user_id=p_user);
$$;

create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from conversation_members cm where cm.conversation_id=p_conversation and cm.user_id=p_user);
$$;

create or replace function public.can_view_post(p_post uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_author uuid;
begin
  select author_id into v_author from posts where id=p_post;
  if v_author is null then return false; end if;
  if v_author=p_user then return true; end if;

  -- Explicit exclusion always wins.
  if exists(select 1 from audience_rules r where r.post_id=p_post and r.rule_type='exclude_user' and r.subject_id=p_user) then return false; end if;

  if exists(select 1 from audience_rules r where r.post_id=p_post and r.rule_type='include_user' and r.subject_id=p_user) then return true; end if;
  if exists(
    select 1 from audience_rules r
    join circles c on c.id=r.subject_id
    where r.post_id=p_post and r.rule_type='include_circle'
      and (c.owner_id=p_user or exists(select 1 from circle_members cm where cm.circle_id=c.id and cm.user_id=p_user))
  ) then return true; end if;
  if exists(
    select 1 from audience_rules r
    join events e on e.id=r.subject_id
    where r.post_id=p_post and r.rule_type='include_event'
      and (e.owner_id=p_user or exists(select 1 from event_members em where em.event_id=e.id and em.user_id=p_user))
  ) then return true; end if;
  if exists(select 1 from audience_rules r where r.post_id=p_post and r.rule_type='include_friends') and public.is_friend(v_author,p_user) then return true; end if;
  return false;
end $$;

create or replace function public.can_set_audience_rule(
  p_post uuid,
  p_rule public.audience_rule_type,
  p_subject uuid,
  p_user uuid
)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from posts p where p.id=p_post and p.author_id=p_user)
    and case p_rule
      when 'include_friends' then p_subject is null
      when 'include_circle' then p_subject is not null and exists(
        select 1 from circles c
        where c.id=p_subject
          and (c.owner_id=p_user or exists(select 1 from circle_members cm where cm.circle_id=c.id and cm.user_id=p_user))
      )
      when 'include_event' then p_subject is not null and public.can_view_event(p_subject,p_user)
      when 'include_user' then p_subject is not null and exists(select 1 from profiles p where p.id=p_subject)
      when 'exclude_user' then p_subject is not null and exists(select 1 from profiles p where p.id=p_subject)
      else false
    end;
$$;

revoke all on function public.is_friend(uuid,uuid) from public;
revoke all on function public.can_view_event(uuid,uuid) from public;
revoke all on function public.can_view_post(uuid,uuid) from public;
revoke all on function public.can_set_audience_rule(uuid,public.audience_rule_type,uuid,uuid) from public;
revoke all on function public.is_conversation_member(uuid,uuid) from public;
grant execute on function public.is_friend(uuid,uuid), public.can_view_event(uuid,uuid), public.can_view_post(uuid,uuid), public.can_set_audience_rule(uuid,public.audience_rule_type,uuid,uuid), public.is_conversation_member(uuid,uuid) to authenticated;

alter table profiles enable row level security;
alter table friendships enable row level security;
alter table circles enable row level security;
alter table circle_members enable row level security;
alter table events enable row level security;
alter table event_members enable row level security;
alter table posts enable row level security;
alter table post_media enable row level security;
alter table audience_rules enable row level security;
alter table comments enable row level security;
alter table reactions enable row level security;
alter table saves enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table invites enable row level security;

create policy "profiles readable by signed in users" on profiles for select to authenticated using (true);
create policy "users update own profile" on profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy "users insert own profile" on profiles for insert to authenticated with check (id=auth.uid());

create policy "friendship participants read" on friendships for select to authenticated using (auth.uid() in (requester_id,addressee_id));
create policy "requester creates friendship" on friendships for insert to authenticated with check (requester_id=auth.uid());
create policy "participants update friendship" on friendships for update to authenticated using (auth.uid() in (requester_id,addressee_id));

create policy "circle owner reads" on circles for select to authenticated using (owner_id=auth.uid() or exists(select 1 from circle_members cm where cm.circle_id=id and cm.user_id=auth.uid()));
create policy "circle owner writes" on circles for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "circle members readable" on circle_members for select to authenticated using (exists(select 1 from circles c where c.id=circle_id and (c.owner_id=auth.uid() or user_id=auth.uid())));
create policy "circle owner manages members" on circle_members for all to authenticated using (exists(select 1 from circles c where c.id=circle_id and c.owner_id=auth.uid())) with check (exists(select 1 from circles c where c.id=circle_id and c.owner_id=auth.uid()));

create policy "event members read event" on events for select to authenticated using (public.can_view_event(id,auth.uid()));
create policy "event owner writes event" on events for all to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
create policy "event members readable" on event_members for select to authenticated using (public.can_view_event(event_id,auth.uid()));
create policy "event owner manages membership" on event_members for all to authenticated using (exists(select 1 from events e where e.id=event_id and e.owner_id=auth.uid())) with check (exists(select 1 from events e where e.id=event_id and e.owner_id=auth.uid()));

create policy "authorized users read posts" on posts for select to authenticated using (public.can_view_post(id,auth.uid()));
create policy "authors insert posts" on posts for insert to authenticated with check (author_id=auth.uid());
create policy "authors update posts" on posts for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid());
create policy "authors delete posts" on posts for delete to authenticated using (author_id=auth.uid());

create policy "authorized users read post media" on post_media for select to authenticated using (public.can_view_post(post_id,auth.uid()));
create policy "authors manage post media" on post_media for all to authenticated using (exists(select 1 from posts p where p.id=post_id and p.author_id=auth.uid())) with check (exists(select 1 from posts p where p.id=post_id and p.author_id=auth.uid()));
create policy "authors manage audience" on audience_rules for all to authenticated
  using (exists(select 1 from posts p where p.id=post_id and p.author_id=auth.uid()))
  with check (public.can_set_audience_rule(post_id,rule_type,subject_id,auth.uid()));

create policy "authorized users read comments" on comments for select to authenticated using (public.can_view_post(post_id,auth.uid()));
create policy "authorized users comment" on comments for insert to authenticated with check (author_id=auth.uid() and public.can_view_post(post_id,auth.uid()) and exists(select 1 from posts p where p.id=post_id and p.comments_enabled));
create policy "authors manage comments" on comments for update to authenticated using (author_id=auth.uid());
create policy "authors delete comments" on comments for delete to authenticated using (author_id=auth.uid());

create policy "authorized users read reactions" on reactions for select to authenticated using (public.can_view_post(post_id,auth.uid()));
create policy "users manage own reactions" on reactions for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.can_view_post(post_id,auth.uid()));

create policy "users read own saves" on saves for select to authenticated using (user_id=auth.uid());
create policy "users manage own saves" on saves for all to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.can_view_post(post_id,auth.uid()));

create policy "members read conversations" on conversations for select to authenticated using (public.is_conversation_member(id,auth.uid()));
create policy "creator inserts conversation" on conversations for insert to authenticated with check (created_by=auth.uid());
create policy "members read memberships" on conversation_members for select to authenticated using (public.is_conversation_member(conversation_id,auth.uid()));
create policy "users can join via server flow" on conversation_members for insert to authenticated with check (user_id=auth.uid() or exists(select 1 from conversations c where c.id=conversation_id and c.created_by=auth.uid()));
create policy "members read messages" on messages for select to authenticated using (public.is_conversation_member(conversation_id,auth.uid()));
create policy "members send messages" on messages for insert to authenticated with check (sender_id=auth.uid() and public.is_conversation_member(conversation_id,auth.uid()));

create policy "users read own notifications" on notifications for select to authenticated using (user_id=auth.uid());
create policy "users update own notifications" on notifications for update to authenticated using (user_id=auth.uid());

create policy "event owners read invites" on invites for select to authenticated using (created_by=auth.uid() or exists(select 1 from events e where e.id=event_id and e.owner_id=auth.uid()));
create policy "event owners create invites" on invites for insert to authenticated with check (created_by=auth.uid() and exists(select 1 from events e where e.id=event_id and (e.owner_id=auth.uid() or exists(select 1 from event_members em where em.event_id=e.id and em.user_id=auth.uid() and em.role='admin'))));
create policy "invite creators update" on invites for update to authenticated using (created_by=auth.uid());

-- Create profile row after signup. Username can be replaced during onboarding.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare
  requested_username text;
  profile_username text;
begin
  requested_username := lower(regexp_replace(coalesce(new.raw_user_meta_data->>'username',''), '[^a-z0-9_]', '', 'g'));
  if requested_username ~ '^[a-z0-9_]{3,30}$' then
    -- Serialize signups competing for the same username before checking uniqueness.
    perform pg_advisory_xact_lock(hashtextextended(requested_username, 0));
    if not exists (select 1 from public.profiles where username=requested_username) then
      profile_username := requested_username;
    else
      profile_username := 'user_' || left(md5(new.id::text),25);
    end if;
  else
    profile_username := 'user_' || left(md5(new.id::text),25);
  end if;
  insert into public.profiles(id, username, display_name)
  values (new.id, profile_username, coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'New RGLR'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
