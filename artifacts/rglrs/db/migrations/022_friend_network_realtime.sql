-- Relationship revocations must invalidate already-rendered private feeds in
-- other active sessions, with client polling retained only as an outage fallback.

alter table public.friendships replica identity full;
alter table public.blocks replica identity full;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='friendships'
    ) then
      alter publication supabase_realtime add table public.friendships;
    end if;
    if not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename='blocks'
    ) then
      alter publication supabase_realtime add table public.blocks;
    end if;
  end if;
end
$$;