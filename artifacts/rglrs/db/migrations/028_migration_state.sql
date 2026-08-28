-- Establish an authoritative, credential-free migration ledger for releases.
-- This migration intentionally verifies the current schema before registering
-- the known forward migration set, so it cannot bless a partially upgraded DB.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.events') is null
     or to_regclass('public.friendships') is null
     or to_regclass('public.blocks') is null
     or to_regclass('public.feed_invalidations') is null
     or to_regclass('public.event_media_exclusions') is null
     or not exists(
       select 1 from information_schema.columns
        where table_schema='public' and table_name='posts' and column_name='allow_downloads'
     )
     or not exists(
       select 1 from information_schema.columns
        where table_schema='public' and table_name='post_media' and column_name='upload_id'
     )
     or not exists(
       select 1 from information_schema.columns
        where table_schema='public' and table_name='message_media' and column_name='object_key'
     )
     or has_column_privilege('authenticated','public.post_media','object_key','select')
     or has_column_privilege('authenticated','public.message_media','object_key','select')
     or not exists(
       select 1 from pg_proc
        where pronamespace='public'::regnamespace and proname='list_feed_page_secure'
     )
     or not exists(
       select 1 from pg_proc
        where pronamespace='public'::regnamespace and proname='set_event_media_sharing_secure'
     )
  then
    raise exception 'RGLRS schema is incomplete; apply migrations 001 through 027 before 028';
  end if;
end
$$;

create table if not exists public.rglrs_migrations (
  version integer primary key check(version>0),
  filename text not null unique check(filename ~ '^[0-9]{3}_[a-z0-9_]+\.sql$'),
  applied_at timestamptz not null default now()
);
revoke all on public.rglrs_migrations from public,anon,authenticated;
grant select on public.rglrs_migrations to service_role;

insert into public.rglrs_migrations(version,filename) values
  (1,'001_initial.sql'),
  (2,'002_post_persistence.sql'),
  (3,'003_saved_collections.sql'),
  (4,'004_profile_username_collision.sql'),
  (5,'005_account_safety.sql'),
  (6,'006_private_media_lifecycle.sql'),
  (7,'007_private_media_hardening.sql'),
  (8,'008_media_completion_expiry.sql'),
  (9,'009_immutable_media_promotion.sql'),
  (10,'010_real_events_invites.sql'),
  (11,'011_event_invite_pin_compatibility.sql'),
  (12,'012_event_invite_pin_schema.sql'),
  (13,'013_event_participation_approval_audit.sql'),
  (14,'014_invite_decision_block_pin_hardening.sql'),
  (15,'015_event_invite_lock_order.sql'),
  (16,'016_real_communications_discovery.sql'),
  (17,'017_communications_lifecycle_cursors.sql'),
  (18,'018_post_locations.sql'),
  (19,'019_profile_avatars.sql'),
  (20,'020_founder_badges.sql'),
  (21,'021_friend_network_feed_rpcs.sql'),
  (22,'022_friend_network_realtime.sql'),
  (23,'023_private_feed_invalidations.sql'),
  (24,'024_feed_invalidation_cascade_safety.sql'),
  (25,'025_event_media_privacy_downloads.sql'),
  (26,'026_private_media_key_boundary.sql'),
  (27,'027_message_media_key_boundary.sql'),
  (28,'028_migration_state.sql')
on conflict (version) do update set filename=excluded.filename;