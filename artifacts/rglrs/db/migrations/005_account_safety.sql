-- Account safety, moderation, and write-abuse controls.  This migration is
-- intentionally forward-only and assumes 001 through 004 have run.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks(blocked_id, blocker_id);
alter table public.blocks enable row level security;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_id uuid references public.profiles(id) on delete set null,
  target_post_id uuid references public.posts(id) on delete set null,
  target_comment_id uuid references public.comments(id) on delete set null,
  target_snapshot_id uuid,
  category text not null check (category in ('harassment','spam','impersonation','hate','privacy','other')),
  details text not null check (char_length(trim(details)) between 10 and 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  constraint reports_has_target check (target_id is not null or target_post_id is not null or target_comment_id is not null or target_snapshot_id is not null),
  constraint reports_not_self check (reporter_id is null or target_id is null or reporter_id <> target_id)
);

-- Normalize the earlier beta moderation table without discarding reports.
do $$
declare
  legacy_shape boolean := exists(
    select 1 from information_schema.columns
     where table_schema='public' and table_name='reports' and column_name='reported_user_id'
  );
begin
  if legacy_shape then
    alter table public.reports rename column reported_user_id to target_id;
    if exists(
      select 1 from information_schema.columns
       where table_schema='public' and table_name='reports' and column_name='post_id'
    ) then
      alter table public.reports rename column post_id to target_post_id;
    end if;
    if exists(
      select 1 from information_schema.columns
       where table_schema='public' and table_name='reports' and column_name='reason'
    ) then
      alter table public.reports rename column reason to category;
    end if;
    if exists(
      select 1 from information_schema.columns
       where table_schema='public' and table_name='reports' and column_name='comment_id'
    ) then
      alter table public.reports rename column comment_id to target_comment_id;
    end if;
    alter table public.reports add column if not exists reviewed_at timestamptz;
    alter table public.reports add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
    alter table public.reports alter column reporter_id drop not null;
    alter table public.reports drop constraint if exists reports_reporter_id_fkey;
    alter table public.reports drop constraint if exists reports_reported_user_id_fkey;
    alter table public.reports drop constraint if exists reports_post_id_fkey;
    alter table public.reports drop constraint if exists reports_comment_id_fkey;
    alter table public.reports
      add constraint reports_reporter_id_fkey foreign key(reporter_id) references public.profiles(id) on delete set null,
      add constraint reports_target_id_fkey foreign key(target_id) references public.profiles(id) on delete set null,
      add constraint reports_target_post_id_fkey foreign key(target_post_id) references public.posts(id) on delete set null,
      add constraint reports_target_comment_id_fkey foreign key(target_comment_id) references public.comments(id) on delete set null;
  end if;
end $$;

alter table public.reports add column if not exists target_comment_id uuid references public.comments(id) on delete set null;
alter table public.reports add column if not exists target_snapshot_id uuid;
update public.reports
   set target_snapshot_id=coalesce(target_id,target_post_id,target_comment_id)
 where target_snapshot_id is null;
alter table public.reports drop constraint if exists report_has_target;
alter table public.reports drop constraint if exists reports_has_target;
alter table public.reports add constraint reports_has_target
  check(target_id is not null or target_post_id is not null or target_comment_id is not null or target_snapshot_id is not null);

create index if not exists reports_reporter_created_idx on public.reports(reporter_id, created_at desc);
alter table public.reports enable row level security;

create table if not exists private.write_rate_counters (
  actor_id uuid not null,
  action text not null,
  window_started timestamptz not null,
  used integer not null default 0,
  primary key (actor_id, action, window_started)
);
revoke all on private.write_rate_counters from public, authenticated, anon;

create table if not exists public.account_deletion_operations (
  user_id uuid primary key,
  object_prefix text not null,
  status text not null check(status in ('removing_media','media_removed','complete')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.account_deletion_operations enable row level security;
revoke all on public.account_deletion_operations from public, authenticated, anon;

create or replace function public.is_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks where (blocker_id=a and blocked_id=b) or (blocker_id=b and blocked_id=a)
  );
$$;

create or replace function private.enforce_write_rate(p_actor uuid, p_action text, p_limit integer)
returns void language plpgsql security definer set search_path=private,public,pg_temp as $$
declare v_window timestamptz := date_trunc('hour', now()); v_used integer;
begin
  if p_actor is null then raise exception 'RATE_LIMITED: authenticated actor required' using errcode='P0001'; end if;
  insert into private.write_rate_counters(actor_id,action,window_started,used)
  values (p_actor,p_action,v_window,1)
  on conflict (actor_id,action,window_started) do update
    set used=private.write_rate_counters.used+1
  returning used into v_used;
  if v_used > p_limit then
    raise exception 'RATE_LIMITED: too many % writes', p_action using errcode='P0001';
  end if;
end $$;

create or replace function public.enforce_authenticated_write_rate()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_actor uuid; v_field text := tg_argv[0];
begin
  -- Auth/signup and service-role maintenance have no request JWT.  RLS still
  -- protects those paths from PostgREST clients; authenticated writes below
  -- are the path subject to the quota.
  if auth.uid() is null then return coalesce(new,old); end if;
  v_actor := coalesce((to_jsonb(new)->>v_field)::uuid, (to_jsonb(old)->>v_field)::uuid);
  if v_actor is distinct from auth.uid() then raise exception 'RATE_LIMITED: actor mismatch' using errcode='P0001'; end if;
  perform private.enforce_write_rate(v_actor,tg_table_name,coalesce(tg_argv[1]::integer,60));
  return coalesce(new,old);
end $$;

create or replace function public.preserve_report_target_snapshot()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.target_snapshot_id is null then
    if tg_op='UPDATE' then
      new.target_snapshot_id := coalesce(new.target_id,new.target_post_id,new.target_comment_id,old.target_id,old.target_post_id,old.target_comment_id);
    else
      new.target_snapshot_id := coalesce(new.target_id,new.target_post_id,new.target_comment_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists preserve_report_target_snapshot on public.reports;
create trigger preserve_report_target_snapshot before insert or update of target_id,target_post_id,target_comment_id
on public.reports for each row execute function public.preserve_report_target_snapshot();

-- Conservative hourly ceilings; all client-facing row writes pass these
-- BEFORE triggers, including direct PostgREST writes.
drop trigger if exists safety_rate_profiles on public.profiles;
create trigger safety_rate_profiles before insert or update on public.profiles for each row execute function public.enforce_authenticated_write_rate('id','30');
drop trigger if exists safety_rate_posts on public.posts;
create trigger safety_rate_posts before insert on public.posts for each row execute function public.enforce_authenticated_write_rate('author_id','30');
drop trigger if exists safety_rate_comments on public.comments;
create trigger safety_rate_comments before insert on public.comments for each row execute function public.enforce_authenticated_write_rate('author_id','60');
drop trigger if exists safety_rate_reactions on public.reactions;
create trigger safety_rate_reactions before insert or update on public.reactions for each row execute function public.enforce_authenticated_write_rate('user_id','120');
drop trigger if exists safety_rate_saves on public.saves;
create trigger safety_rate_saves before insert on public.saves for each row execute function public.enforce_authenticated_write_rate('user_id','120');
drop trigger if exists safety_rate_friendships on public.friendships;
create trigger safety_rate_friendships before insert on public.friendships for each row execute function public.enforce_authenticated_write_rate('requester_id','30');
drop trigger if exists safety_rate_messages on public.messages;
create trigger safety_rate_messages before insert on public.messages for each row execute function public.enforce_authenticated_write_rate('sender_id','120');
drop trigger if exists safety_rate_blocks on public.blocks;
create trigger safety_rate_blocks before insert on public.blocks for each row execute function public.enforce_authenticated_write_rate('blocker_id','60');
drop trigger if exists safety_rate_reports on public.reports;
create trigger safety_rate_reports before insert on public.reports for each row execute function public.enforce_authenticated_write_rate('reporter_id','20');

do $$ begin
  if not exists(select 1 from pg_constraint where conname='profiles_display_name_length') then
    alter table public.profiles add constraint profiles_display_name_length check(char_length(trim(display_name)) between 1 and 80);
    alter table public.profiles add constraint profiles_bio_length check(char_length(bio) <= 240);
    alter table public.posts add constraint posts_caption_length check(char_length(caption) <= 220);
    alter table public.reactions add constraint reactions_reaction_length check(char_length(trim(reaction)) between 1 and 32);
    alter table public.messages add constraint messages_ciphertext_length check(char_length(ciphertext) between 1 and 20000);
  end if;
end $$;

create or replace function public.can_view_circle(p_circle uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1
      from public.circles c
     where c.id=p_circle
       and (
         c.owner_id=p_user
         or (
           not public.is_blocked(c.owner_id,p_user)
           and exists(
             select 1 from public.circle_members cm
              where cm.circle_id=p_circle and cm.user_id=p_user
           )
         )
       )
  );
$$;

create or replace function public.can_view_event(p_event uuid, p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1
      from public.events e
     where e.id=p_event
       and (
         e.owner_id=p_user
         or (
           not public.is_blocked(e.owner_id,p_user)
           and exists(
             select 1 from public.event_members em
              where em.event_id=p_event and em.user_id=p_user
           )
         )
       )
  );
$$;

create or replace function public.can_view_post(p_post uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_author uuid;
begin
  select author_id into v_author from public.posts where id=p_post;
  if v_author is null then return false; end if;
  if v_author=p_user then return true; end if;
  if public.is_blocked(v_author,p_user) then return false; end if;
  if exists(select 1 from public.audience_rules r where r.post_id=p_post and r.rule_type='exclude_user' and r.subject_id=p_user) then return false; end if;
  if exists(select 1 from public.audience_rules r where r.post_id=p_post and r.rule_type='include_user' and r.subject_id=p_user) then return true; end if;
  if exists(select 1 from public.audience_rules r join public.circles c on c.id=r.subject_id where r.post_id=p_post and r.rule_type='include_circle' and (c.owner_id=p_user or exists(select 1 from public.circle_members cm where cm.circle_id=c.id and cm.user_id=p_user))) then return true; end if;
  if exists(select 1 from public.audience_rules r join public.events e on e.id=r.subject_id where r.post_id=p_post and r.rule_type='include_event' and public.can_view_event(e.id,p_user)) then return true; end if;
  return exists(select 1 from public.audience_rules r where r.post_id=p_post and r.rule_type='include_friends') and public.is_friend(v_author,p_user);
end $$;

create or replace function public.can_set_audience_rule(p_post uuid,p_rule public.audience_rule_type,p_subject uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.posts p where p.id=p_post and p.author_id=p_user) and case p_rule
 when 'include_friends' then p_subject is null
 when 'include_circle' then p_subject is not null and exists(select 1 from public.circles c where c.id=p_subject and c.owner_id=p_user)
 when 'include_event' then p_subject is not null and public.can_view_event(p_subject,p_user)
 when 'include_user' then p_subject is not null and p_subject<>p_user and public.is_friend(p_user,p_subject) and not public.is_blocked(p_user,p_subject)
 when 'exclude_user' then p_subject is not null and p_subject<>p_user and public.is_friend(p_user,p_subject) and not public.is_blocked(p_user,p_subject)
 else false end;
$$;

create or replace function public.is_conversation_member(p_conversation uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.conversation_members me where me.conversation_id=p_conversation and me.user_id=p_user)
 and not exists(select 1 from public.conversation_members x join public.conversation_members y on y.conversation_id=x.conversation_id and x.user_id<y.user_id where x.conversation_id=p_conversation and public.is_blocked(x.user_id,y.user_id));
$$;

drop policy if exists "profiles readable by signed in users" on public.profiles;
drop policy if exists "profiles readable unless blocked" on public.profiles;
create policy "profiles readable unless blocked" on public.profiles for select to authenticated using (id=auth.uid() or not public.is_blocked(id,auth.uid()));
drop policy if exists "friendship participants read" on public.friendships;
drop policy if exists "requester creates friendship" on public.friendships;
drop policy if exists "requester creates unblocked friendship" on public.friendships;
create policy "friendship participants read" on public.friendships for select to authenticated using (auth.uid() in (requester_id,addressee_id) and not public.is_blocked(requester_id,addressee_id));
create policy "requester creates unblocked friendship" on public.friendships for insert to authenticated with check(requester_id=auth.uid() and not public.is_blocked(requester_id,addressee_id));
drop policy if exists "participants update friendship" on public.friendships;
drop policy if exists "participants update unblocked friendship" on public.friendships;
create policy "participants update unblocked friendship" on public.friendships for update to authenticated using(auth.uid() in (requester_id,addressee_id) and not public.is_blocked(requester_id,addressee_id)) with check(not public.is_blocked(requester_id,addressee_id));
drop policy if exists "authors manage post media" on public.post_media;
drop policy if exists "authors insert owned post media" on public.post_media;
drop policy if exists "authors update owned post media" on public.post_media;
drop policy if exists "authors delete post media" on public.post_media;
create policy "authors insert owned post media" on public.post_media for insert to authenticated with check(
  object_key ~ ('^originals/'||auth.uid()::text||'/')
  and exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid())
);
create policy "authors update owned post media" on public.post_media for update to authenticated
  using(exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()))
  with check(object_key ~ ('^originals/'||auth.uid()::text||'/') and exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()));
create policy "authors delete post media" on public.post_media for delete to authenticated using(
  exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid())
);
drop policy if exists "circle owner reads" on public.circles;
drop policy if exists "circle members read unblocked circle" on public.circles;
create policy "circle members read unblocked circle" on public.circles for select to authenticated using(public.can_view_circle(id,auth.uid()));
drop policy if exists "circle members readable" on public.circle_members;
drop policy if exists "circle members readable when unblocked" on public.circle_members;
create policy "circle members readable when unblocked" on public.circle_members for select to authenticated using(public.can_view_circle(circle_id,auth.uid()) and (user_id=auth.uid() or not public.is_blocked(user_id,auth.uid())));
drop policy if exists "circle owner manages members" on public.circle_members;
drop policy if exists "circle owner manages eligible members" on public.circle_members;
create policy "circle owner manages eligible members" on public.circle_members for all to authenticated
  using (exists(select 1 from public.circles c where c.id=circle_id and c.owner_id=auth.uid()))
  with check (exists(
    select 1 from public.circles c
     where c.id=circle_id
       and c.owner_id=auth.uid()
       and (
         user_id=auth.uid()
         or (public.is_friend(auth.uid(),user_id) and not public.is_blocked(auth.uid(),user_id))
       )
  ));
drop policy if exists "event members read event" on public.events;
drop policy if exists "event members read unblocked event" on public.events;
create policy "event members read unblocked event" on public.events for select to authenticated using(owner_id=auth.uid() or (not public.is_blocked(owner_id,auth.uid()) and public.can_view_event(id,auth.uid())));
drop policy if exists "event members readable" on public.event_members;
drop policy if exists "event members readable when unblocked" on public.event_members;
create policy "event members readable when unblocked" on public.event_members for select to authenticated using((user_id=auth.uid() or not public.is_blocked(user_id,auth.uid())) and exists(select 1 from public.events e where e.id=event_id and (e.owner_id=auth.uid() or (not public.is_blocked(e.owner_id,auth.uid()) and public.can_view_event(event_id,auth.uid())))));
drop policy if exists "event owner manages membership" on public.event_members;
drop policy if exists "event owner manages unblocked membership" on public.event_members;
create policy "event owner manages unblocked membership" on public.event_members for all to authenticated
  using (exists(select 1 from public.events e where e.id=event_id and e.owner_id=auth.uid()))
  with check (exists(
    select 1 from public.events e
     where e.id=event_id
       and e.owner_id=auth.uid()
       and not public.is_blocked(auth.uid(),user_id)
  ));
drop policy if exists "creator inserts conversation" on public.conversations;
create policy "creator inserts conversation" on public.conversations for insert to authenticated with check(created_by=auth.uid());
drop policy if exists "users can join via server flow" on public.conversation_members;
drop policy if exists "users join unblocked conversations" on public.conversation_members;
create policy "users join unblocked conversations" on public.conversation_members for insert to authenticated with check((user_id=auth.uid() or exists(select 1 from public.conversations c where c.id=conversation_id and c.created_by=auth.uid())) and not exists(select 1 from public.conversation_members cm where cm.conversation_id=conversation_id and public.is_blocked(cm.user_id,user_id)));
drop policy if exists "members send messages" on public.messages;
drop policy if exists "members send unblocked messages" on public.messages;
create policy "members send unblocked messages" on public.messages for insert to authenticated with check(sender_id=auth.uid() and public.is_conversation_member(conversation_id,auth.uid()));
drop policy if exists "users read own notifications" on public.notifications;
drop policy if exists "users read safe notifications" on public.notifications;
create policy "users read safe notifications" on public.notifications for select to authenticated using(user_id=auth.uid() and (actor_id is null or not public.is_blocked(actor_id,auth.uid())));
drop policy if exists "block owners manage blocks" on public.blocks;
create policy "block owners manage blocks" on public.blocks for all to authenticated using(blocker_id=auth.uid()) with check(blocker_id=auth.uid() and blocker_id<>blocked_id);
drop policy if exists "reporters read own reports" on public.reports;
create policy "reporters read own reports" on public.reports for select to authenticated using(reporter_id=auth.uid());
drop policy if exists "reporters create reports" on public.reports;
grant select, insert, update, delete on
  public.profiles, public.friendships, public.circles, public.circle_members,
  public.events, public.event_members, public.posts, public.audience_rules,
  public.post_media, public.comments, public.reactions, public.saves,
  public.saved_collections, public.saved_collection_posts, public.conversations,
  public.conversation_members, public.messages, public.notifications,
  public.blocks, public.reports
to authenticated;
revoke insert, update, delete on public.reports from authenticated, anon;
grant select on public.reports to authenticated;

create or replace function public.block_member(p_blocked uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if auth.uid() is null or p_blocked is null or p_blocked=auth.uid() then raise exception 'invalid block target'; end if;
 if not exists(select 1 from public.profiles where id=p_blocked) then raise exception 'invalid block target'; end if;
 insert into public.blocks(blocker_id,blocked_id) values(auth.uid(),p_blocked) on conflict do nothing;
 delete from public.friendships where (requester_id=auth.uid() and addressee_id=p_blocked) or (requester_id=p_blocked and addressee_id=auth.uid());
 delete from public.circle_members cm
  using public.circles c
  where cm.circle_id=c.id
    and ((c.owner_id=auth.uid() and cm.user_id=p_blocked) or (c.owner_id=p_blocked and cm.user_id=auth.uid()));
end $$;
create or replace function public.unblock_member(p_blocked uuid) returns void language sql security definer set search_path=public,pg_temp as $$ delete from public.blocks where blocker_id=auth.uid() and blocked_id=p_blocked $$;
create or replace function public.report_member(p_target uuid,p_category text,p_details text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$ declare v_id uuid; begin
 if auth.uid() is null or p_target is null or p_target=auth.uid() or not exists(select 1 from public.profiles where id=p_target) then raise exception 'invalid report target'; end if;
 if p_category not in ('harassment','spam','impersonation','hate','privacy','other') or char_length(trim(coalesce(p_details,''))) not between 10 and 1000 then raise exception 'invalid report details'; end if;
 insert into public.reports(reporter_id,target_id,category,details) values(auth.uid(),p_target,p_category,trim(p_details)) returning id into v_id; return v_id; end $$;
drop function if exists public.list_blocked_members();
create function public.list_blocked_members() returns table(user_id uuid,display_name text,username text,blocked_at timestamptz) language sql stable security definer set search_path=public,pg_temp as $$ select b.blocked_id,p.display_name,p.username,b.created_at from public.blocks b join public.profiles p on p.id=b.blocked_id where b.blocker_id=auth.uid() order by b.created_at desc $$;
create or replace function public.eligible_audience_profiles() returns table(id uuid,display_name text,username text) language sql stable security definer set search_path=public,pg_temp as $$ select p.id,p.display_name,p.username from public.profiles p where p.id<>auth.uid() and public.is_friend(auth.uid(),p.id) and not public.is_blocked(auth.uid(),p.id) order by p.display_name $$;
create or replace function public.search_profiles(p_query text) returns table(id uuid,display_name text,username text)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.id,p.display_name,p.username
    from public.profiles p
   where auth.uid() is not null
     and p.id<>auth.uid()
     and not public.is_blocked(auth.uid(),p.id)
     and char_length(trim(p_query)) between 2 and 60
     and (p.display_name ilike '%'||trim(p_query)||'%' or p.username ilike '%'||trim(p_query)||'%')
   order by p.display_name
   limit 20
$$;

create or replace function public.create_post_secure(p_caption text,p_audience text,p_subject_ids uuid[],p_media jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_subject uuid; v_item jsonb; v_rule public.audience_rule_type;
begin
 if auth.uid() is null or coalesce(char_length(p_caption),0)>220 or p_audience not in ('private','friends','circles','events','people','except') then raise exception 'invalid post input'; end if;
 if coalesce(jsonb_array_length(p_media),0)>8 or jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array' then raise exception 'invalid media'; end if;
 if p_audience in ('private','friends') and coalesce(cardinality(p_subject_ids),0)<>0 then raise exception 'invalid audience subjects'; end if;
 if p_audience in ('circles','events','people','except') and coalesce(cardinality(p_subject_ids),0)=0 then raise exception 'invalid audience subjects'; end if;
 insert into public.posts(author_id,caption,audience_kind) values(auth.uid(),coalesce(p_caption,''),p_audience) returning id into v_id;
 if p_audience in ('friends','except') then insert into public.audience_rules(post_id,rule_type) values(v_id,'include_friends'); end if;
 foreach v_subject in array coalesce(p_subject_ids,'{}'::uuid[]) loop
   v_rule := case p_audience when 'people' then 'include_user'::public.audience_rule_type when 'except' then 'exclude_user'::public.audience_rule_type when 'circles' then 'include_circle'::public.audience_rule_type when 'events' then 'include_event'::public.audience_rule_type end;
   if not public.can_set_audience_rule(v_id,v_rule,v_subject,auth.uid()) then raise exception 'invalid audience subject'; end if;
   insert into public.audience_rules(post_id,rule_type,subject_id) values(v_id,v_rule,v_subject);
 end loop;
 for v_item in select value from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) loop
   if coalesce(v_item->>'object_key','') !~ ('^originals/'||auth.uid()::text||'/') or v_item->>'media_type' not in ('image','video') then raise exception 'invalid media'; end if;
   insert into public.post_media(post_id,object_key,media_type,width,height,duration_ms,sort_order) values(v_id,v_item->>'object_key',v_item->>'media_type',nullif(v_item->>'width','')::int,nullif(v_item->>'height','')::int,nullif(v_item->>'duration_ms','')::int,coalesce((v_item->>'sort_order')::int,0));
 end loop; return v_id;
end $$;
create or replace function public.add_comment_secure(p_post uuid,p_body text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$ declare v_id uuid; begin
 if auth.uid() is null or p_post is null or char_length(trim(coalesce(p_body,''))) not between 1 and 5000 or not public.can_view_post(p_post,auth.uid()) or not exists(select 1 from public.posts where id=p_post and comments_enabled) then raise exception 'invalid comment'; end if;
  insert into public.comments(post_id,author_id,body) values(p_post,auth.uid(),trim(p_body)) returning id into v_id; return v_id; end $$;

revoke all on function public.is_blocked(uuid,uuid), public.can_view_circle(uuid,uuid), public.can_view_event(uuid,uuid), private.enforce_write_rate(uuid,text,integer), public.enforce_authenticated_write_rate(), public.preserve_report_target_snapshot(), public.block_member(uuid), public.unblock_member(uuid), public.report_member(uuid,text,text), public.list_blocked_members(), public.eligible_audience_profiles(), public.search_profiles(text), public.create_post_secure(text,text,uuid[],jsonb), public.add_comment_secure(uuid,text) from public, anon;
grant execute on function public.is_blocked(uuid,uuid), public.can_view_circle(uuid,uuid), public.can_view_event(uuid,uuid), public.block_member(uuid), public.unblock_member(uuid), public.report_member(uuid,text,text), public.list_blocked_members(), public.eligible_audience_profiles(), public.search_profiles(text), public.create_post_secure(text,text,uuid[],jsonb), public.add_comment_secure(uuid,text) to authenticated;