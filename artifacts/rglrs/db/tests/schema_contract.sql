-- Verifies the production schema shape without retaining data.
begin;

do $$
begin
  if to_regclass('public.rglrs_migrations') is null
     or not exists(
        select 1 from public.rglrs_migrations
         where version=34 and filename='034_signup_invites.sql'
     )
  then
    raise exception 'migration ledger is missing or stale';
  end if;
  if has_table_privilege('authenticated','public.rglrs_migrations','select')
     or has_table_privilege('anon','public.rglrs_migrations','select')
  then
    raise exception 'migration ledger is browser-readable';
  end if;
  if position('auth.users' in lower(pg_get_functiondef(
       'public.get_privacy_settings_secure()'::regprocedure
     )))>0
     or position('auth.users' in lower(pg_get_functiondef(
       'public.set_privacy_settings_secure(jsonb,jsonb,jsonb)'::regprocedure
     )))>0
  then
    raise exception 'privacy RPCs cross the server-only auth email boundary';
  end if;
  if to_regprocedure('public.claim_private_media_cleanup()') is null
     or to_regprocedure('public.release_private_media_cleanup()') is null
     or has_function_privilege('authenticated','public.claim_private_media_cleanup()','execute')
     or has_function_privilege('authenticated','public.release_private_media_cleanup()','execute')
  then
    raise exception 'private-media cleanup lease contract is invalid';
  end if;
  if to_regclass('public.media_uploads') is null then
    raise exception 'media_uploads table is missing';
  end if;
  if has_table_privilege('authenticated','public.media_uploads','select')
     or has_table_privilege('anon','public.media_uploads','select')
     or to_regprocedure('public.release_deleted_post_upload()') is null
     or position('30 days' in lower(pg_get_functiondef('public.release_deleted_post_upload()'::regprocedure)))=0
  then
    raise exception 'published-media recovery hold or upload lifecycle boundary is invalid';
  end if;
  if not exists(
    select 1 from information_schema.columns
     where table_schema='public' and table_name='post_media' and column_name='upload_id'
  ) then
    raise exception 'post_media.upload_id is missing';
  end if;
  if not exists(
    select 1 from pg_proc
     where pronamespace='public'::regnamespace and proname='create_post_secure'
  ) then
    raise exception 'secure post creation is missing';
  end if;
  if not exists(
    select 1 from pg_proc
     where pronamespace='public'::regnamespace and proname='reserve_media_upload'
  ) then
    raise exception 'atomic media reservation is missing';
  end if;
  if not exists(
    select 1 from pg_proc
     where pronamespace='public'::regnamespace and proname='complete_media_upload'
  ) then
    raise exception 'atomic media completion is missing';
  end if;
  if not exists(
    select 1 from pg_proc
     where pronamespace='public'::regnamespace and proname='begin_media_promotion'
  ) then
    raise exception 'immutable media promotion is missing';
  end if;
  if exists(
    select 1 from pg_policies
     where schemaname='public' and tablename='post_media'
       and cmd='DELETE'
  ) then
    raise exception 'direct claimed-media deletion remains enabled';
  end if;
  if has_table_privilege('authenticated','public.post_media','select')
     or has_column_privilege('authenticated','public.post_media','object_key','select')
     or has_column_privilege('anon','public.post_media','object_key','select')
     or not has_column_privilege('authenticated','public.post_media','id','select')
     or not has_column_privilege('authenticated','public.post_media','media_type','select')
     or not has_column_privilege('authenticated','public.post_media','sort_order','select')
  then
    raise exception 'post media browser column boundary is incorrect';
  end if;
  if has_table_privilege('authenticated','public.message_media','select')
     or has_column_privilege('authenticated','public.message_media','object_key','select')
     or has_column_privilege('anon','public.message_media','object_key','select')
     or not has_column_privilege('authenticated','public.message_media','id','select')
     or not has_column_privilege('authenticated','public.message_media','media_type','select')
     or not has_column_privilege('authenticated','public.message_media','sort_order','select')
  then
    raise exception 'message media browser column boundary is incorrect';
  end if;
  if to_regclass('public.event_invite_redemptions') is null
     or to_regclass('public.friendships_canonical_pair_idx') is null
     or to_regclass('public.invites_event_active_idx') is null
  then
    raise exception 'event/invite hardening tables or indexes are missing';
  end if;
  if to_regclass('private.invite_pin_attempts') is null then
    raise exception 'private invite PIN throttle table is missing';
  end if;
  if not exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='private' and c.relname='invite_pin_attempts'
       and c.relkind='r' and c.relrowsecurity
  ) then
    raise exception 'invite PIN throttle RLS is disabled';
  end if;
  if has_table_privilege('authenticated','private.invite_pin_attempts','select')
    or has_table_privilege('authenticated','private.invite_pin_attempts','insert')
    or has_table_privilege('authenticated','private.invite_pin_attempts','update')
    or has_table_privilege('authenticated','private.invite_pin_attempts','delete')
    or has_table_privilege('anon','private.invite_pin_attempts','select')
  then
    raise exception 'invite PIN throttle table is client-accessible';
  end if;
end $$;

do $$
declare
  required_table text;
  rls_enabled boolean;
begin
  foreach required_table in array array[
    'profiles',
    'friendships',
    'circles',
    'circle_members',
    'events',
    'event_members',
    'event_media_exclusions',
    'privacy_settings',
    'privacy_default_audience_rules',
    'person_privacy_overrides',
    'posts',
    'post_media',
    'audience_rules',
    'comments',
    'reactions',
    'saves',
    'saved_collections',
    'saved_collection_posts',
    'conversations',
    'conversation_members',
    'messages',
     'message_media',
    'notifications',
    'invites',
    'event_invite_redemptions',
    'blocks',
    'reports'
  ]
  loop
    select c.relrowsecurity
      into rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = required_table
       and c.relkind = 'r';

    if not found then
      raise exception 'required table public.% is missing', required_table;
    end if;
    if not rls_enabled then
      raise exception 'row level security is disabled on public.%', required_table;
    end if;
  end loop;

  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'posts'
       and column_name = 'audience_kind'
  ) then
    raise exception 'posts.audience_kind is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='posts'
       and column_name='allow_downloads'
       and column_default='false'
       and is_nullable='NO'
  ) then
    raise exception 'posts.allow_downloads is missing or not default-off';
  end if;
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'posts'
       and column_name = 'location_name'
  ) then
    raise exception 'posts.location_name is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='posts' and column_name='location_address'
  ) then
    raise exception 'posts.location_address is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='events' and column_name='place_address'
  ) then
    raise exception 'events.place_address is missing';
  end if;
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'avatar_upload_id'
  ) then
    raise exception 'profiles.avatar_upload_id is missing';
  end if;
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'is_founder'
  ) then
    raise exception 'profiles.is_founder is missing';
  end if;
  if not exists(
    select 1 from information_schema.columns
     where table_schema='public' and table_name='event_members'
       and column_name='participation_mode' and is_nullable='NO'
  ) then
    raise exception 'event_members.participation_mode is missing or nullable';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='messages' and column_name='body')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='updated_at')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversation_members' and column_name='last_read_at')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversation_members' and column_name='last_read_message_id')
    or to_regclass('public.messages_sender_client_message_unique') is null
    or to_regclass('public.notifications_dedupe_unique') is null
  then
    raise exception 'communications columns or idempotency indexes are missing';
  end if;
  if not exists(
    select 1 from information_schema.columns
     where table_schema='public' and table_name='event_invite_redemptions' and column_name='decided_by'
  ) then
    raise exception 'invite decision actor audit is missing';
  end if;

  if to_regclass('public.posts_created_idx') is null
    or to_regclass('public.saves_user_created_idx') is null
    or to_regclass('public.saved_collections_owner_created_idx') is null
    or to_regclass('public.saved_collection_posts_collection_added_idx') is null
    or to_regclass('public.blocks_blocked_idx') is null
    or to_regclass('public.reports_reporter_created_idx') is null
  then
    raise exception 'one or more required feed/save indexes are missing';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'posts'
       and policyname = 'authorized users read posts'
  ) then
    raise exception 'authorized post read policy is missing';
  end if;
  if not exists(
    select 1 from pg_policies
     where schemaname='public' and tablename='posts'
       and policyname='authors insert non-event posts'
       and lower(with_check) like '%event_id is null%'
       and lower(with_check) like '%audience_kind%'
  ) then
    raise exception 'direct event-post insertion remains enabled';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'saved_collection_posts'
       and policyname = 'owners read collection posts'
  ) then
    raise exception 'saved collection privacy policy is missing';
  end if;

  if to_regprocedure('public.block_member(uuid)') is null
    or to_regprocedure('public.report_member(uuid,text,text)') is null
    or to_regprocedure('public.create_post_secure(text,text,uuid[],jsonb)') is null
    or to_regprocedure('public.create_post_secure(text,text,uuid[],jsonb,text)') is null
    or to_regprocedure('public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)') is null
    or to_regprocedure('public.update_profile_secure(text,text,text)') is null
    or to_regprocedure('public.set_profile_avatar_secure(uuid)') is null
    or to_regprocedure('public.add_comment_secure(uuid,text)') is null
    or to_regprocedure('public.privacy_allows(uuid,uuid,text)') is null
    or to_regprocedure('public.get_privacy_settings_secure()') is null
    or to_regprocedure('public.set_privacy_settings_secure(jsonb,jsonb,jsonb)') is null
     or to_regprocedure('public.can_view_profile_photo(uuid,uuid)') is null
     or to_regprocedure('public.can_download_media(uuid,uuid)') is null
     or to_regprocedure('public.list_profile_connections_secure(uuid)') is null
     or to_regprocedure('public.reshare_post_secure(uuid)') is null
  then
    raise exception 'one or more account safety RPCs are missing';
  end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='posts' and column_name='shared_from_post_id')
     or position('privacy_allows(auth.uid(),v_inv.created_by,''event_invite_policy'')' in lower(pg_get_functiondef('public.redeem_event_invite_secure(text,text)'::regprocedure)))=0
     or position('privacy_allows(p_user,v_creator,''event_invite_policy'')' in lower(pg_get_functiondef('public.decide_event_invite_redemption_secure(uuid,uuid,boolean)'::regprocedure)))=0
  then raise exception 'invite privacy or internal resharing contract is missing'; end if;
  if position('if v_audience is null then' in lower(pg_get_functiondef(
       'public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)'::regprocedure
     )))=0
     or position('default_media_downloads' in lower(pg_get_functiondef(
       'public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)'::regprocedure
     )))=0
     or position('event_media_exclusions' in lower(pg_get_functiondef(
       'public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)'::regprocedure
     )))=0
  then
    raise exception 'seven-argument post defaults or event exclusion reuse is missing';
  end if;
  if position('privacy_allows(v_member,v_actor,''message_policy'')' in
       lower(pg_get_functiondef('public.create_conversation_secure(uuid[],text)'::regprocedure)))=0
     or position('if v_id is not null then return v_id' in
       lower(pg_get_functiondef('public.create_conversation_secure(uuid[],text)'::regprocedure))) <
        position('privacy_allows(v_member,v_actor,''message_policy'')' in
       lower(pg_get_functiondef('public.create_conversation_secure(uuid[],text)'::regprocedure)))
  then
    raise exception 'direct conversation message-policy deny-before-grant is missing';
  end if;
  if to_regprocedure('public.create_conversation_secure(uuid[],text)') is null
    or to_regprocedure('public.list_conversations_secure()') is null
    or to_regprocedure('public.mark_conversation_read_secure(uuid,timestamp with time zone,uuid)') is null
    or to_regprocedure('public.send_message_secure(uuid,text,uuid,uuid[])') is null
    or to_regprocedure('public.list_messages_secure(uuid,timestamp with time zone,uuid,integer)') is null
    or to_regprocedure('public.list_notifications_secure(timestamp with time zone,uuid,integer)') is null
    or to_regprocedure('public.mark_notification_read_secure(uuid)') is null
    or to_regprocedure('public.mark_all_notifications_read_secure()') is null
    or to_regprocedure('public.unread_counts_secure()') is null
    or to_regprocedure('public.search_authorized(text,integer)') is null
  then
    raise exception 'one or more communications/discovery RPCs are missing';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversations'
      and column_name='created_by' and is_nullable<>'YES')
    or not exists(select 1 from pg_constraint where conrelid='public.conversations'::regclass
      and conname='conversations_created_by_fkey' and pg_get_constraintdef(oid) ilike '%ON DELETE SET NULL%')
    or not exists(select 1 from pg_constraint where conrelid='public.conversation_members'::regclass
      and conname='conversation_members_last_read_message_id_fkey')
    or to_regprocedure('public.cleanup_empty_conversation()') is null
    or to_regprocedure('public.cleanup_polymorphic_notifications()') is null
    or to_regprocedure('public.mark_conversation_read_secure(uuid,timestamp with time zone)') is not null
  then
    raise exception 'shared conversation lifecycle or read cursor contract is incorrect';
  end if;
  if lower(pg_get_functiondef('public.list_notifications_secure(timestamp with time zone,uuid,integer)'::regprocedure))
      not like '%/people/%'
    or lower(pg_get_functiondef('public.list_notifications_secure(timestamp with time zone,uuid,integer)'::regprocedure))
      like '%/profile/%'
  then
    raise exception 'notification href contract is not canonical';
  end if;
  if has_table_privilege('authenticated','public.conversations','insert')
    or has_table_privilege('authenticated','public.conversation_members','insert')
    or has_table_privilege('authenticated','public.messages','insert')
    or has_table_privilege('authenticated','public.message_media','insert')
    or has_table_privilege('authenticated','public.notifications','update')
    or has_table_privilege('authenticated','public.notifications','delete')
    or has_function_privilege('anon','public.search_authorized(text,integer)','execute')
    or not has_function_privilege('authenticated','public.search_authorized(text,integer)','execute')
  then
    raise exception 'communications table/RPC grants are incorrect';
  end if;

  if to_regprocedure('public.create_friend_request_secure(uuid)') is null
    or to_regprocedure('public.respond_friend_request_secure(uuid,text)') is null
    or to_regprocedure('public.remove_friendship_secure(uuid)') is null
    or to_regprocedure('public.create_circle_secure(text,text)') is null
    or to_regprocedure('public.set_circle_members_secure(uuid,uuid[])') is null
    or to_regprocedure('public.create_event_secure(text,text,timestamp with time zone,timestamp with time zone,text,boolean)') is null
    or to_regprocedure('public.create_event_secure(text,text,timestamp with time zone,timestamp with time zone,text,text,boolean)') is null
    or to_regprocedure('public.update_event_secure(uuid,text,text,timestamp with time zone,timestamp with time zone,text,boolean)') is null
    or to_regprocedure('public.update_event_secure(uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,boolean)') is null
    or to_regprocedure('public.delete_event_secure(uuid)') is null
    or to_regprocedure('public.set_event_member_secure(uuid,uuid,text,boolean)') is null
    or to_regprocedure('public.leave_event_secure(uuid)') is null
    or to_regprocedure('public.create_event_invite_secure(uuid,text,text,text,timestamp with time zone,integer)') is null
    or to_regprocedure('public.revoke_event_invite_secure(uuid)') is null
    or to_regprocedure('public.redeem_event_invite_secure(text,text)') is null
    or to_regprocedure('public.decide_event_invite_redemption_secure(uuid,uuid,boolean)') is null
    or to_regprocedure('public.list_event_invite_requests_secure(uuid)') is null
  then
    raise exception 'one or more event workflow RPCs are missing';
  end if;
  if not has_function_privilege('authenticated','public.block_member(uuid)','execute')
    or not has_function_privilege('authenticated','public.redeem_event_invite_secure(text,text)','execute')
    or not has_function_privilege('authenticated','public.decide_event_invite_redemption_secure(uuid,uuid,boolean)','execute')
    or not has_function_privilege('authenticated','public.update_profile_secure(text,text,text)','execute')
    or not has_function_privilege('authenticated','public.set_profile_avatar_secure(uuid)','execute')
    or has_table_privilege('authenticated','public.profiles','update')
    or has_function_privilege('anon','public.redeem_event_invite_secure(text,text)','execute')
    or has_function_privilege('anon','public.decide_event_invite_redemption_secure(uuid,uuid,boolean)','execute')
    or has_function_privilege('anon','public.update_profile_secure(text,text,text)','execute')
    or has_function_privilege('anon','public.set_profile_avatar_secure(uuid)','execute')
    or not has_function_privilege('authenticated','public.get_privacy_settings_secure()','execute')
    or not has_function_privilege('authenticated','public.set_privacy_settings_secure(jsonb,jsonb,jsonb)','execute')
    or has_function_privilege('anon','public.get_privacy_settings_secure()','execute')
    or not has_table_privilege('authenticated','public.privacy_settings','select')
    or not has_table_privilege('authenticated','public.privacy_default_audience_rules','select')
    or not has_table_privilege('authenticated','public.person_privacy_overrides','select')
    or has_table_privilege('authenticated','public.privacy_settings','insert,update,delete')
    or has_table_privilege('authenticated','public.privacy_default_audience_rules','insert,update,delete')
    or has_table_privilege('authenticated','public.person_privacy_overrides','insert,update,delete')
  then
    raise exception 'invite/block/profile RPC grants are incorrect';
  end if;

  if not exists(
    select 1 from pg_constraint
     where conrelid='public.event_members'::regclass
       and conname='event_members_participation_mode_check'
  ) or not exists(
    select 1 from pg_constraint
     where conrelid='public.event_invite_redemptions'::regclass
       and conname='event_invite_redemptions_status_check'
       and pg_get_constraintdef(oid) like '%declined%'
  ) then
    raise exception 'event participation or approval decision constraints are missing';
  end if;

  if has_table_privilege('authenticated','public.invites','select')
    or has_table_privilege('authenticated','public.friendships','insert')
    or has_table_privilege('authenticated','public.circle_members','delete')
    or has_table_privilege('authenticated','public.events','update')
    or has_table_privilege('authenticated','public.event_members','insert')
  then
    raise exception 'direct event workflow mutation or invite disclosure remains enabled';
  end if;
  if not has_table_privilege('authenticated','public.event_media_exclusions','select')
    or has_table_privilege('authenticated','public.event_media_exclusions','insert')
    or has_table_privilege('authenticated','public.event_media_exclusions','update')
    or has_table_privilege('authenticated','public.event_media_exclusions','delete')
    or not has_function_privilege('authenticated','public.set_event_media_sharing_secure(uuid,uuid[])','execute')
    or not has_function_privilege('authenticated','public.set_post_downloads_secure(uuid,boolean)','execute')
    or not has_function_privilege('authenticated','public.unshare_event_post_secure(uuid)','execute')
    or not has_function_privilege('authenticated','public.update_post_secure(uuid,text,text,uuid[],text,boolean)','execute')
    or not has_function_privilege('authenticated','public.create_post_secure(text,text,uuid[],jsonb,text,boolean)','execute')
    or not has_function_privilege('authenticated','public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean)','execute')
    or has_function_privilege('authenticated','public.create_post_secure(text,text,uuid[],jsonb)','execute')
    or has_function_privilege('authenticated','public.create_post_secure(text,text,uuid[],jsonb,text)','execute')
    or has_function_privilege('anon','public.set_event_media_sharing_secure(uuid,uuid[])','execute')
    or has_table_privilege('authenticated','public.posts','update')
    or has_table_privilege('authenticated','public.audience_rules','insert')
    or has_table_privilege('authenticated','public.audience_rules','update')
    or has_table_privilege('authenticated','public.audience_rules','delete')
  then
    raise exception 'event media privacy grants are incorrect';
  end if;
end $$;

do $$
declare
  v_decide text:=lower(pg_get_functiondef('public.decide_event_invite_redemption_secure(uuid,uuid,boolean)'::regprocedure));
  v_redeem text:=lower(pg_get_functiondef('public.redeem_event_invite_secure(text,text)'::regprocedure));
  v_event_lock integer;
  v_auth_check integer;
  v_invite_lock integer;
  v_redemption_lock integer;
begin
  v_event_lock:=position('from public.events where id=v_event for update' in v_decide);
  v_auth_check:=position('from public.event_members admin' in v_decide);
  v_invite_lock:=position('from public.invites' in substring(v_decide from v_auth_check+1))+v_auth_check;
  v_redemption_lock:=position('from public.event_invite_redemptions' in v_decide);
  if v_event_lock=0 or v_auth_check<=v_event_lock or v_invite_lock<=v_auth_check
     or v_redemption_lock<=v_invite_lock
  then
    raise exception 'approval decision does not lock event before authorization, invite, and redemption';
  end if;

  v_event_lock:=position('from public.events where id=v_event for update' in v_redeem);
  v_invite_lock:=position('where token_hash=p_token_hash and event_id=v_event for update' in v_redeem);
  if v_event_lock=0 or v_invite_lock<=v_event_lock then
    raise exception 'invite redemption does not follow event-before-invite lock order';
  end if;
end $$;

rollback;