-- Per-user invalidations remain deliverable after a friendship or block change
-- revokes access to the relationship rows that caused the change.

create table if not exists public.feed_invalidations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check(reason in ('friendship','block')),
  created_at timestamptz not null default now()
);
create index if not exists feed_invalidations_user_created_idx
  on public.feed_invalidations(user_id,created_at desc,id desc);
alter table public.feed_invalidations enable row level security;

drop policy if exists "owners read feed invalidations" on public.feed_invalidations;
create policy "owners read feed invalidations" on public.feed_invalidations
  for select to authenticated using(user_id=auth.uid());

revoke all on public.feed_invalidations from public,anon,authenticated;
grant select on public.feed_invalidations to authenticated;

create or replace function public.emit_private_feed_invalidation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_left uuid; v_right uuid; v_reason text;
begin
  if tg_table_name='friendships' then
    v_left:=coalesce(new.requester_id,old.requester_id);
    v_right:=coalesce(new.addressee_id,old.addressee_id);
    v_reason:='friendship';
  elsif tg_table_name='blocks' then
    v_left:=coalesce(new.blocker_id,old.blocker_id);
    v_right:=coalesce(new.blocked_id,old.blocked_id);
    v_reason:='block';
  else
    raise exception 'invalid feed invalidation source';
  end if;
  insert into public.feed_invalidations(user_id,reason)
  select x,v_reason
  from unnest(array[v_left,v_right]) x
  join public.profiles p on p.id=x
  where x is not null;
  return coalesce(new,old);
end
$$;

revoke all on function public.emit_private_feed_invalidation() from public,anon,authenticated;

drop trigger if exists invalidate_feed_for_friendship on public.friendships;
create trigger invalidate_feed_for_friendship
after insert or update of status or delete on public.friendships
for each row execute function public.emit_private_feed_invalidation();

drop trigger if exists invalidate_feed_for_block on public.blocks;
create trigger invalidate_feed_for_block
after insert or delete on public.blocks
for each row execute function public.emit_private_feed_invalidation();

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='feed_invalidations'
    )
  then
    alter publication supabase_realtime add table public.feed_invalidations;
  end if;
end
$$;