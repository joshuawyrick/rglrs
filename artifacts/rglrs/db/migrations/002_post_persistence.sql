-- Forward migration for projects that already applied 001_initial.sql.

alter table public.posts
  add column if not exists audience_kind text not null default 'private';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'posts_audience_kind_check'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_audience_kind_check
      check (audience_kind in ('private','friends','circles','events','people','except'));
  end if;
end $$;

create index if not exists posts_created_idx on public.posts(created_at desc, id desc);

create or replace function public.can_view_post(p_post uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_author uuid;
begin
  select author_id into v_author from posts where id=p_post;
  if v_author is null then return false; end if;
  if v_author=p_user then return true; end if;

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

revoke all on function public.can_view_post(uuid,uuid) from public;
revoke all on function public.can_set_audience_rule(uuid,public.audience_rule_type,uuid,uuid) from public;
grant execute on function public.can_view_post(uuid,uuid), public.can_set_audience_rule(uuid,public.audience_rule_type,uuid,uuid) to authenticated;

create table if not exists public.saves (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists saves_user_created_idx on public.saves(user_id, created_at desc);
alter table public.saves enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'saves' and policyname = 'users read own saves'
  ) then
    create policy "users read own saves" on public.saves
      for select to authenticated using (user_id=auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'saves' and policyname = 'users manage own saves'
  ) then
    create policy "users manage own saves" on public.saves
      for all to authenticated
      using (user_id=auth.uid())
      with check (user_id=auth.uid() and public.can_view_post(post_id,auth.uid()));
  end if;
end $$;

-- Raw audience subject IDs remain author-only. The non-sensitive category is on posts.
drop policy if exists "authorized users read audience" on public.audience_rules;
drop policy if exists "authors manage audience" on public.audience_rules;
create policy "authors manage audience" on public.audience_rules for all to authenticated
  using (exists(select 1 from public.posts p where p.id=post_id and p.author_id=auth.uid()))
  with check (public.can_set_audience_rule(post_id,rule_type,subject_id,auth.uid()));