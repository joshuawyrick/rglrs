-- Private collections for organizing saved posts.

create table if not exists public.saved_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists saved_collections_owner_created_idx
  on public.saved_collections(owner_id, created_at asc, id asc);

create table if not exists public.saved_collection_posts (
  collection_id uuid not null references public.saved_collections(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, post_id)
);
create index if not exists saved_collection_posts_collection_added_idx
  on public.saved_collection_posts(collection_id, added_at desc, post_id desc);

alter table public.saved_collections enable row level security;
alter table public.saved_collection_posts enable row level security;

drop policy if exists "owners manage saved collections" on public.saved_collections;
create policy "owners manage saved collections" on public.saved_collections
  for all to authenticated
  using (owner_id=auth.uid())
  with check (owner_id=auth.uid());

drop policy if exists "owners read collection posts" on public.saved_collection_posts;
create policy "owners read collection posts" on public.saved_collection_posts
  for select to authenticated
  using (
    exists(
      select 1 from public.saved_collections c
      where c.id=collection_id and c.owner_id=auth.uid()
    )
    and exists(
      select 1 from public.saves s
      where s.post_id=post_id and s.user_id=auth.uid()
    )
    and public.can_view_post(post_id,auth.uid())
  );

drop policy if exists "owners add collection posts" on public.saved_collection_posts;
create policy "owners add collection posts" on public.saved_collection_posts
  for insert to authenticated
  with check (
    exists(
      select 1 from public.saved_collections c
      where c.id=collection_id and c.owner_id=auth.uid()
    )
    and exists(
      select 1 from public.saves s
      where s.post_id=post_id and s.user_id=auth.uid()
    )
    and public.can_view_post(post_id,auth.uid())
  );

drop policy if exists "owners remove collection posts" on public.saved_collection_posts;
create policy "owners remove collection posts" on public.saved_collection_posts
  for delete to authenticated
  using (exists(
    select 1 from public.saved_collections c
    where c.id=collection_id and c.owner_id=auth.uid()
  ));

create or replace function public.remove_unsaved_collection_memberships()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  delete from public.saved_collection_posts membership
  using public.saved_collections collection
  where membership.collection_id=collection.id
    and collection.owner_id=old.user_id
    and membership.post_id=old.post_id;
  return old;
end $$;

revoke all on function public.remove_unsaved_collection_memberships() from public;

drop trigger if exists remove_unsaved_collection_memberships on public.saves;
create trigger remove_unsaved_collection_memberships
  after delete on public.saves
  for each row execute function public.remove_unsaved_collection_memberships();