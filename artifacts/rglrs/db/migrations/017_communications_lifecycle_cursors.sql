-- Shared conversation lifecycle, canonical notification links, and tie-safe read cursors.

alter table public.conversations alter column created_by drop not null;
alter table public.conversations drop constraint if exists conversations_created_by_fkey;
alter table public.conversations add constraint conversations_created_by_fkey
  foreign key(created_by) references public.profiles(id) on delete set null;

-- Claimed uploads and their owning profile may be deleted by the same account
-- cascade. Defer the cross-reference check until all post/message cascades run.
alter table public.post_media drop constraint if exists post_media_upload_id_fkey;
alter table public.post_media add constraint post_media_upload_id_fkey
  foreign key(upload_id) references public.media_uploads(id)
  on delete no action deferrable initially deferred;
alter table public.message_media drop constraint if exists message_media_upload_id_fkey;
alter table public.message_media add constraint message_media_upload_id_fkey
  foreign key(upload_id) references public.media_uploads(id)
  on delete no action deferrable initially deferred;

alter table public.conversation_members add column if not exists last_read_message_id uuid;
do $$ begin
  if not exists(
    select 1 from pg_constraint where conname='conversation_members_last_read_message_id_fkey'
      and conrelid='public.conversation_members'::regclass
  ) then
    alter table public.conversation_members add constraint conversation_members_last_read_message_id_fkey
      foreign key(last_read_message_id) references public.messages(id) on delete set null;
  end if;
end $$;

-- Resolve legacy timestamp-only cursors to the greatest message pair at or before
-- that timestamp. A missing id is treated as the minimum UUID by readers.
update public.conversation_members cm
set last_read_message_id=(
  select m.id from public.messages m
  where m.conversation_id=cm.conversation_id and m.created_at<=cm.last_read_at
  order by m.created_at desc,m.id desc limit 1
)
where cm.last_read_at is not null and cm.last_read_message_id is null;

create or replace function public.lock_conversation_membership_delete()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('conversation:'||old.conversation_id::text,0));
  perform 1 from public.conversations where id=old.conversation_id for update;
  return old;
end $$;

create or replace function public.cleanup_empty_conversation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from public.conversations c
   where c.id=old.conversation_id
     and not exists(select 1 from public.conversation_members cm where cm.conversation_id=c.id);
  return old;
end $$;

drop trigger if exists lock_conversation_membership_delete on public.conversation_members;
create trigger lock_conversation_membership_delete before delete on public.conversation_members
for each row execute function public.lock_conversation_membership_delete();
drop trigger if exists cleanup_empty_conversation on public.conversation_members;
create trigger cleanup_empty_conversation after delete on public.conversation_members
for each row execute function public.cleanup_empty_conversation();

create or replace function public.cleanup_polymorphic_notifications()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entity_type text;
begin
  v_entity_type:=case tg_table_name
    when 'conversations' then 'conversation'
    when 'posts' then 'post'
    when 'events' then 'event'
    when 'friendships' then 'friendship'
  end;
  if v_entity_type is not null then
    delete from public.notifications where entity_type=v_entity_type and entity_id=old.id;
  end if;
  return old;
end $$;

drop trigger if exists cleanup_conversation_notifications on public.conversations;
create trigger cleanup_conversation_notifications after delete on public.conversations
for each row execute function public.cleanup_polymorphic_notifications();
drop trigger if exists cleanup_post_notifications on public.posts;
create trigger cleanup_post_notifications after delete on public.posts
for each row execute function public.cleanup_polymorphic_notifications();
drop trigger if exists cleanup_event_notifications on public.events;
create trigger cleanup_event_notifications after delete on public.events
for each row execute function public.cleanup_polymorphic_notifications();
drop trigger if exists cleanup_friendship_notifications on public.friendships;
create trigger cleanup_friendship_notifications after delete on public.friendships
for each row execute function public.cleanup_polymorphic_notifications();

drop function if exists public.list_conversations_secure();
create function public.list_conversations_secure()
returns table(
  conversation_id uuid,title text,is_group boolean,created_at timestamptz,updated_at timestamptz,
  presentation_name text,presentation_avatar_key text,last_message_id uuid,last_message_body text,
  last_message_sender_id uuid,last_message_created_at timestamptz,unread_count bigint
) language sql stable security definer set search_path=public,pg_temp as $$
  select c.id,c.title,c.is_group,c.created_at,c.updated_at,
    case when c.is_group then c.title else peer.display_name end,
    case when c.is_group then null else peer.avatar_key end,
    lm.id,lm.body,lm.sender_id,lm.created_at,
    (select count(*) from public.messages um
      where um.conversation_id=c.id and um.sender_id<>auth.uid()
        and (um.created_at,um.id)>(
          coalesce(me.last_read_at,'-infinity'::timestamptz),
          coalesce(me.last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid)
        ))::bigint
  from public.conversation_members me
  join public.conversations c on c.id=me.conversation_id
  left join lateral (
    select p.display_name,p.avatar_key from public.conversation_members pcm
    join public.profiles p on p.id=pcm.user_id
    where pcm.conversation_id=c.id and pcm.user_id<>auth.uid()
    order by p.display_name,p.id limit 1
  ) peer on true
  left join lateral (
    select m.id,m.body,m.sender_id,m.created_at from public.messages m
    where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1
  ) lm on true
  where me.user_id=auth.uid() and public.is_conversation_member(c.id,auth.uid())
  order by c.updated_at desc,c.id desc
$$;

drop function if exists public.mark_conversation_read_secure(uuid,timestamptz);
drop function if exists public.mark_conversation_read_secure(uuid,timestamptz,uuid);
create function public.mark_conversation_read_secure(
  p_conversation uuid,p_through timestamptz,p_through_id uuid
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_through is null or p_through_id is null
     or not public.is_conversation_member(p_conversation,auth.uid())
     or not exists(
       select 1 from public.messages m
        where m.id=p_through_id and m.conversation_id=p_conversation and m.created_at=p_through
     )
  then return false; end if;
  update public.conversation_members
     set last_read_at=p_through,last_read_message_id=p_through_id
   where conversation_id=p_conversation and user_id=auth.uid()
     and (last_read_at is null or (last_read_at,coalesce(last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid))
       <(p_through,p_through_id))
   returning conversation_id into v_id;
  -- A valid cursor at or behind the current cursor remains an idempotent success.
  return v_id is not null or exists(
    select 1 from public.conversation_members
     where conversation_id=p_conversation and user_id=auth.uid()
  );
end $$;

create or replace function public.send_message_secure(
  p_conversation uuid,p_body text,p_client_message_id uuid,p_upload_ids uuid[]
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_id uuid; v_created_at timestamptz; v_upload public.media_uploads%rowtype;
  v_upload_id uuid; v_order integer:=0; v_uploads uuid[];
begin
  if v_actor is null or p_conversation is null or p_client_message_id is null then raise exception 'invalid message'; end if;
  select array_agg(distinct x order by x) into v_uploads from unnest(coalesce(p_upload_ids,'{}'::uuid[])) x;
  if coalesce(cardinality(v_uploads),0)>8 then raise exception 'too many message attachments'; end if;
  if coalesce(cardinality(v_uploads),0)<>coalesce(cardinality(p_upload_ids),0) then raise exception 'duplicate message attachment'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 5000 and coalesce(cardinality(v_uploads),0)=0 then raise exception 'message body or media required'; end if;
  if char_length(trim(coalesce(p_body,'')))>5000 then raise exception 'message body too long'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  if not found or not public.is_conversation_member(p_conversation,v_actor) then raise exception 'conversation access denied'; end if;
  if exists(select 1 from public.conversation_members a join public.conversation_members b
    on b.conversation_id=a.conversation_id and a.user_id<b.user_id
    where a.conversation_id=p_conversation and public.is_blocked(a.user_id,b.user_id))
  then raise exception 'conversation access denied'; end if;
  select id,created_at into v_id,v_created_at from public.messages
   where sender_id=v_actor and client_message_id=p_client_message_id for update;
  if v_id is not null then
    if not exists(select 1 from public.messages where id=v_id and conversation_id=p_conversation
      and body is not distinct from nullif(trim(coalesce(p_body,'')),''))
      or coalesce((select array_agg(mm.upload_id order by mm.sort_order) from public.message_media mm where mm.message_id=v_id),'{}'::uuid[])
         is distinct from coalesce(p_upload_ids,'{}'::uuid[])
    then raise exception 'client message id conflict'; end if;
    return v_id;
  end if;
  perform private.enforce_write_rate(v_actor,'messages',120);
  foreach v_upload_id in array coalesce(v_uploads,'{}'::uuid[]) loop
    select * into v_upload from public.media_uploads where id=v_upload_id and owner_id=v_actor
      and status='uploaded' and expires_at>now()
      and object_key like 'originals/'||v_actor::text||'/published/%' for update;
    if not found then raise exception 'invalid message media'; end if;
  end loop;
  insert into public.messages(conversation_id,sender_id,body,client_message_id)
  values(p_conversation,v_actor,nullif(trim(coalesce(p_body,'')),''),p_client_message_id)
  returning id,created_at into v_id,v_created_at;
  foreach v_upload_id in array coalesce(p_upload_ids,'{}'::uuid[]) loop
    select * into v_upload from public.media_uploads where id=v_upload_id for update;
    insert into public.message_media(message_id,upload_id,sender_id,object_key,media_type,width,height,duration_ms,sort_order)
    values(v_id,v_upload.id,v_actor,v_upload.object_key,v_upload.media_type,v_upload.width,v_upload.height,v_upload.duration_ms,v_order);
    update public.media_uploads set status='claimed',message_id=v_id,post_id=null,
      expires_at=now()+interval '100 years',updated_at=now() where id=v_upload.id;
    v_order:=v_order+1;
  end loop;
  update public.conversations set updated_at=v_created_at where id=p_conversation;
  update public.conversation_members set last_read_at=v_created_at,last_read_message_id=v_id
    where conversation_id=p_conversation and user_id=v_actor;
  return v_id;
end $$;

create or replace function public.unread_counts_secure()
returns table(message_count bigint,notification_count bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  select
    (select count(*) from public.conversation_members cm join public.messages m on m.conversation_id=cm.conversation_id
      where cm.user_id=auth.uid() and m.sender_id<>auth.uid()
        and (m.created_at,m.id)>(
          coalesce(cm.last_read_at,'-infinity'::timestamptz),
          coalesce(cm.last_read_message_id,'00000000-0000-0000-0000-000000000000'::uuid)
        )
        and public.is_conversation_member(cm.conversation_id,auth.uid()))::bigint,
    (select count(*) from public.notifications n where n.user_id=auth.uid() and n.read_at is null
      and (n.actor_id is null or not public.is_blocked(n.actor_id,auth.uid())))::bigint
$$;

create or replace function public.list_notifications_secure(p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns table(
  id uuid,actor_id uuid,actor_display_name text,actor_username text,actor_avatar_key text,
  type text,entity_type text,entity_id uuid,href text,read_at timestamptz,created_at timestamptz
) language sql stable security definer set search_path=public,pg_temp as $$
  select n.id,n.actor_id,p.display_name,p.username,p.avatar_key,n.type,n.entity_type,n.entity_id,
    case n.entity_type
      when 'friendship' then '/people/'||n.actor_id::text
      when 'event' then '/events/'||n.entity_id::text
      when 'post' then '/post/'||n.entity_id::text
      when 'conversation' then '/messages/'||n.entity_id::text
    end,n.read_at,n.created_at
  from public.notifications n left join public.profiles p on p.id=n.actor_id
  where n.user_id=auth.uid() and (n.actor_id is null or not public.is_blocked(n.actor_id,auth.uid()))
    and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by n.created_at desc,n.id desc
  limit least(greatest(coalesce(p_limit,40),1),100)
$$;

revoke all on function public.lock_conversation_membership_delete(),
  public.cleanup_empty_conversation(),public.cleanup_polymorphic_notifications(),
  public.list_conversations_secure(),
  public.mark_conversation_read_secure(uuid,timestamptz,uuid),
  public.send_message_secure(uuid,text,uuid,uuid[]),public.unread_counts_secure(),
  public.list_notifications_secure(timestamptz,uuid,integer)
from public,anon,authenticated;
grant execute on function public.list_conversations_secure(),
  public.mark_conversation_read_secure(uuid,timestamptz,uuid),
  public.send_message_secure(uuid,text,uuid,uuid[]),public.unread_counts_secure(),
  public.list_notifications_secure(timestamptz,uuid,integer)
to authenticated;