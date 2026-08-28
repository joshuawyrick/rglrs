-- Actor-derived communications, notification, and discovery boundaries.
-- E2EE is intentionally out of scope: message bodies are stored as plaintext.

alter table public.conversations add column if not exists updated_at timestamptz not null default now();
alter table public.conversations add column if not exists direct_key text;
alter table public.conversation_members add column if not exists last_read_at timestamptz;
alter table public.messages add column if not exists body text;
alter table public.messages alter column ciphertext drop not null;
alter table public.media_uploads add column if not exists message_id uuid;
alter table public.notifications add column if not exists dedupe_key text;

update public.conversations set updated_at=created_at where updated_at is null;
delete from public.notifications where entity_id is null or (type,entity_type) not in (
  ('friend_request','friendship'),('friend_accepted','friendship'),
  ('event_invitation','event'),('event_approval_accepted','event'),('event_approval_declined','event'),
  ('comment','post'),('reaction','post'),('message','conversation')
);
-- Preserve the oldest row if legacy clients reused an idempotency key.
with duplicates as (
  select id,row_number() over(partition by sender_id,client_message_id order by created_at,id) rn
  from public.messages where client_message_id is not null
)
update public.messages m set client_message_id=null from duplicates d where d.id=m.id and d.rn>1;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='messages_body_length' and conrelid='public.messages'::regclass) then
    alter table public.messages add constraint messages_body_length
      check(body is null or char_length(body) between 1 and 5000);
  end if;
  if not exists(select 1 from pg_constraint where conname='media_uploads_message_id_fkey' and conrelid='public.media_uploads'::regclass) then
    alter table public.media_uploads add constraint media_uploads_message_id_fkey
      foreign key(message_id) references public.messages(id) on delete set null;
  end if;
  if not exists(select 1 from pg_constraint where conname='notifications_safe_entity' and conrelid='public.notifications'::regclass) then
    alter table public.notifications add constraint notifications_safe_entity check(
      entity_id is not null and (type,entity_type) in (
        ('friend_request','friendship'),('friend_accepted','friendship'),
        ('event_invitation','event'),('event_approval_accepted','event'),('event_approval_declined','event'),
        ('comment','post'),('reaction','post'),('message','conversation')
      )
    );
  end if;
end $$;

create unique index if not exists conversations_direct_key_unique
  on public.conversations(direct_key) where direct_key is not null;
create unique index if not exists messages_sender_client_message_unique
  on public.messages(sender_id,client_message_id) where client_message_id is not null;
create index if not exists conversation_members_user_updated_idx
  on public.conversation_members(user_id,conversation_id);
create index if not exists messages_conversation_cursor_idx
  on public.messages(conversation_id,created_at desc,id desc);
create unique index if not exists notifications_dedupe_unique
  on public.notifications(dedupe_key) where dedupe_key is not null;
create index if not exists notifications_user_cursor_idx
  on public.notifications(user_id,created_at desc,id desc);

create table if not exists public.message_media (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  upload_id uuid not null unique references public.media_uploads(id) on delete restrict,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  object_key text not null,
  media_type text not null check(media_type in ('image','video')),
  width integer,
  height integer,
  duration_ms integer,
  sort_order integer not null check(sort_order between 0 and 7),
  created_at timestamptz not null default now(),
  unique(message_id,sort_order)
);
alter table public.message_media enable row level security;

-- Browser clients can read only their rows. All communications mutations are RPC-only.
drop policy if exists "creator inserts conversation" on public.conversations;
drop policy if exists "users can join via server flow" on public.conversation_members;
drop policy if exists "users join unblocked conversations" on public.conversation_members;
drop policy if exists "members send messages" on public.messages;
drop policy if exists "members send unblocked messages" on public.messages;
drop policy if exists "users update own notifications" on public.notifications;
drop policy if exists "members read conversations" on public.conversations;
drop policy if exists "members read memberships" on public.conversation_members;
drop policy if exists "members read messages" on public.messages;
drop policy if exists "users read own notifications" on public.notifications;
drop policy if exists "users read safe notifications" on public.notifications;
drop policy if exists "participants read message media" on public.message_media;

create policy "participants read conversations" on public.conversations for select to authenticated
  using(public.is_conversation_member(id,auth.uid()));
create policy "participants read memberships" on public.conversation_members for select to authenticated
  using(public.is_conversation_member(conversation_id,auth.uid()));
create policy "participants read messages" on public.messages for select to authenticated
  using(public.is_conversation_member(conversation_id,auth.uid()));
create policy "participants read message media" on public.message_media for select to authenticated
  using(exists(
    select 1 from public.messages m
     where m.id=message_id and public.is_conversation_member(m.conversation_id,auth.uid())
  ));
create policy "owners read safe notifications" on public.notifications for select to authenticated
  using(user_id=auth.uid() and (actor_id is null or not public.is_blocked(actor_id,auth.uid())));

revoke insert,update,delete on public.conversations,public.conversation_members,
  public.messages,public.message_media,public.notifications from public,anon,authenticated;
revoke select on public.conversations,public.conversation_members,public.messages,
  public.message_media,public.notifications from public,anon;
grant select on public.conversations,public.conversation_members,public.messages,
  public.notifications to authenticated;
grant select(
  id,message_id,sender_id,media_type,width,height,duration_ms,sort_order,created_at
) on public.message_media to authenticated;

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
  -- Every participant pair is serialized identically with block_member.
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
        and um.created_at>coalesce(me.last_read_at,'-infinity'::timestamptz))::bigint
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

create or replace function public.mark_conversation_read_secure(p_conversation uuid,p_through timestamptz)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_max timestamptz;
begin
  if auth.uid() is null or p_through is null or not public.is_conversation_member(p_conversation,auth.uid()) then return false; end if;
  select max(created_at) into v_max from public.messages where conversation_id=p_conversation;
  update public.conversation_members
     set last_read_at=greatest(coalesce(last_read_at,'-infinity'::timestamptz),least(p_through,coalesce(v_max,p_through)))
   where conversation_id=p_conversation and user_id=auth.uid()
   returning conversation_id into v_id;
  return v_id is not null;
end $$;

create or replace function public.send_message_secure(
  p_conversation uuid,p_body text,p_client_message_id uuid,p_upload_ids uuid[]
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare
  v_actor uuid:=auth.uid(); v_id uuid; v_upload public.media_uploads%rowtype;
  v_upload_id uuid; v_order integer:=0; v_uploads uuid[];
begin
  if v_actor is null or p_conversation is null or p_client_message_id is null then raise exception 'invalid message'; end if;
  select array_agg(distinct x order by x) into v_uploads from unnest(coalesce(p_upload_ids,'{}'::uuid[])) x;
  if coalesce(cardinality(v_uploads),0)>8 then raise exception 'too many message attachments'; end if;
  if coalesce(cardinality(v_uploads),0)<>coalesce(cardinality(p_upload_ids),0) then raise exception 'duplicate message attachment'; end if;
  if char_length(trim(coalesce(p_body,''))) not between 1 and 5000 and coalesce(cardinality(v_uploads),0)=0 then
    raise exception 'message body or media required';
  end if;
  if char_length(trim(coalesce(p_body,'')))>5000 then raise exception 'message body too long'; end if;
  perform 1 from public.conversations where id=p_conversation for update;
  if not found or not public.is_conversation_member(p_conversation,v_actor) then raise exception 'conversation access denied'; end if;
  if exists(
    select 1 from public.conversation_members a join public.conversation_members b
      on b.conversation_id=a.conversation_id and a.user_id<b.user_id
     where a.conversation_id=p_conversation and public.is_blocked(a.user_id,b.user_id)
  ) then raise exception 'conversation access denied'; end if;
  select id into v_id from public.messages
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
  -- Lock uploads in UUID order before inserting anything.
  foreach v_upload_id in array coalesce(v_uploads,'{}'::uuid[]) loop
    select * into v_upload from public.media_uploads
     where id=v_upload_id and owner_id=v_actor and status='uploaded' and expires_at>now()
       and object_key like 'originals/'||v_actor::text||'/published/%'
     for update;
    if not found then raise exception 'invalid message media'; end if;
  end loop;
  insert into public.messages(conversation_id,sender_id,body,client_message_id)
  values(p_conversation,v_actor,nullif(trim(coalesce(p_body,'')),''),p_client_message_id) returning id into v_id;
  foreach v_upload_id in array coalesce(p_upload_ids,'{}'::uuid[]) loop
    select * into v_upload from public.media_uploads where id=v_upload_id for update;
    insert into public.message_media(message_id,upload_id,sender_id,object_key,media_type,width,height,duration_ms,sort_order)
    values(v_id,v_upload.id,v_actor,v_upload.object_key,v_upload.media_type,v_upload.width,v_upload.height,v_upload.duration_ms,v_order);
    update public.media_uploads set status='claimed',message_id=v_id,post_id=null,
      expires_at=now()+interval '100 years',updated_at=now() where id=v_upload.id;
    v_order:=v_order+1;
  end loop;
  update public.conversations set updated_at=now() where id=p_conversation;
  update public.conversation_members set last_read_at=now()
    where conversation_id=p_conversation and user_id=v_actor;
  return v_id;
end $$;

drop function if exists public.list_messages_secure(uuid,timestamptz,uuid,integer);
create function public.list_messages_secure(
  p_conversation uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns table(
  id uuid,conversation_id uuid,sender_id uuid,sender_display_name text,sender_username text,
  sender_avatar_key text,body text,client_message_id uuid,created_at timestamptz,media jsonb
) language sql stable security definer set search_path=public,pg_temp as $$
  select m.id,m.conversation_id,m.sender_id,p.display_name,p.username,p.avatar_key,
    m.body,m.client_message_id,m.created_at,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',mm.id,'media_type',mm.media_type,'width',mm.width,'height',mm.height,
      'duration_ms',mm.duration_ms,'sort_order',mm.sort_order
    ) order by mm.sort_order) from public.message_media mm where mm.message_id=m.id),'[]'::jsonb)
  from public.messages m join public.profiles p on p.id=m.sender_id
  where m.conversation_id=p_conversation
    and public.is_conversation_member(p_conversation,auth.uid())
    and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by m.created_at desc,m.id desc
  limit least(greatest(coalesce(p_limit,40),1),100)
$$;

create or replace function public.release_deleted_message_upload()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.media_uploads set status='uploaded',message_id=null,expires_at=now(),updated_at=now()
   where id=old.upload_id and status='claimed';
  return old;
end $$;
drop trigger if exists release_deleted_message_upload on public.message_media;
create trigger release_deleted_message_upload after delete on public.message_media
for each row execute function public.release_deleted_message_upload();

-- Only fixed internal trigger events may enqueue notifications. Links are derived by the listing RPC.
create or replace function private.enqueue_notification(
  p_user uuid,p_actor uuid,p_type text,p_entity_type text,p_entity_id uuid,p_dedupe text
) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
  if p_user is null or p_user=p_actor or (p_actor is not null and public.is_blocked(p_user,p_actor)) then return; end if;
  if (p_type,p_entity_type) not in (
    ('friend_request','friendship'),('friend_accepted','friendship'),
    ('event_invitation','event'),('event_approval_accepted','event'),('event_approval_declined','event'),
    ('comment','post'),('reaction','post'),('message','conversation')
  ) or p_entity_id is null or p_dedupe is null then raise exception 'invalid notification event'; end if;
  insert into public.notifications(user_id,actor_id,type,entity_type,entity_id,dedupe_key)
  values(p_user,p_actor,p_type,p_entity_type,p_entity_id,p_dedupe)
  on conflict(dedupe_key) where dedupe_key is not null do nothing;
end $$;

create or replace function public.emit_communications_notification()
returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_owner uuid; v_event uuid; v_user uuid;
begin
  if tg_table_name='friendships' then
    if tg_op='INSERT' and new.status='pending' then
      perform private.enqueue_notification(new.addressee_id,new.requester_id,'friend_request','friendship',new.id,'friend_request:'||new.id);
    elsif tg_op='UPDATE' and new.status='accepted' and old.status is distinct from 'accepted' then
      perform private.enqueue_notification(new.requester_id,new.addressee_id,'friend_accepted','friendship',new.id,'friend_accepted:'||new.id);
    end if;
  elsif tg_table_name='comments' then
    select author_id into v_owner from public.posts where id=new.post_id;
    perform private.enqueue_notification(v_owner,new.author_id,'comment','post',new.post_id,'comment:'||new.id);
  elsif tg_table_name='reactions' then
    select author_id into v_owner from public.posts where id=new.post_id;
    perform private.enqueue_notification(v_owner,new.user_id,'reaction','post',new.post_id,'reaction:'||new.post_id||':'||new.user_id);
  elsif tg_table_name='messages' then
    for v_user in select user_id from public.conversation_members where conversation_id=new.conversation_id and user_id<>new.sender_id loop
      perform private.enqueue_notification(v_user,new.sender_id,'message','conversation',new.conversation_id,'message:'||new.id||':'||v_user);
    end loop;
  elsif tg_table_name='event_invite_redemptions' then
    select i.event_id into v_event from public.invites i where i.id=new.invite_id;
    if tg_op='INSERT' and new.status='pending' then
      for v_user in select user_id from public.event_members where event_id=v_event and role in ('owner','admin') loop
        perform private.enqueue_notification(v_user,new.user_id,'event_invitation','event',v_event,'event_invitation:'||new.invite_id||':'||new.user_id||':'||v_user);
      end loop;
    elsif tg_op='UPDATE' and new.status in ('accepted','declined') and old.status='pending' then
      perform private.enqueue_notification(new.user_id,new.decided_by,
        case when new.status='accepted' then 'event_approval_accepted' else 'event_approval_declined' end,
        'event',v_event,'event_approval:'||new.invite_id||':'||new.user_id);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists notify_friendship on public.friendships;
create trigger notify_friendship after insert or update of status on public.friendships
for each row execute function public.emit_communications_notification();
drop trigger if exists notify_comment on public.comments;
create trigger notify_comment after insert on public.comments for each row execute function public.emit_communications_notification();
drop trigger if exists notify_reaction on public.reactions;
create trigger notify_reaction after insert or update on public.reactions for each row execute function public.emit_communications_notification();
drop trigger if exists notify_message on public.messages;
create trigger notify_message after insert on public.messages for each row execute function public.emit_communications_notification();
drop trigger if exists notify_event_invitation on public.event_invite_redemptions;
create trigger notify_event_invitation after insert or update of status on public.event_invite_redemptions
for each row execute function public.emit_communications_notification();

drop function if exists public.list_notifications_secure(timestamptz,uuid,integer);
create function public.list_notifications_secure(p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns table(
  id uuid,actor_id uuid,actor_display_name text,actor_username text,actor_avatar_key text,
  type text,entity_type text,entity_id uuid,href text,read_at timestamptz,created_at timestamptz
) language sql stable security definer set search_path=public,pg_temp as $$
  select n.id,n.actor_id,p.display_name,p.username,p.avatar_key,n.type,n.entity_type,n.entity_id,
    case n.entity_type
      when 'friendship' then '/profile/'||coalesce(p.username,n.actor_id::text)
      when 'event' then '/events/'||n.entity_id::text
      when 'post' then '/post/'||n.entity_id::text
      when 'conversation' then '/messages/'||n.entity_id::text
    end,
    n.read_at,n.created_at
  from public.notifications n left join public.profiles p on p.id=n.actor_id
  where n.user_id=auth.uid() and (n.actor_id is null or not public.is_blocked(n.actor_id,auth.uid()))
    and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by n.created_at desc,n.id desc
  limit least(greatest(coalesce(p_limit,40),1),100)
$$;

create or replace function public.mark_notification_read_secure(p_notification uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  update public.notifications set read_at=coalesce(read_at,now())
   where id=p_notification and user_id=auth.uid() returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.mark_all_notifications_read_secure()
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count bigint;
begin
  update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null;
  get diagnostics v_count=row_count; return v_count;
end $$;

drop function if exists public.unread_counts_secure();
create function public.unread_counts_secure()
returns table(message_count bigint,notification_count bigint)
language sql stable security definer set search_path=public,pg_temp as $$
  select
    (select count(*) from public.conversation_members cm join public.messages m on m.conversation_id=cm.conversation_id
      where cm.user_id=auth.uid() and m.sender_id<>auth.uid()
        and m.created_at>coalesce(cm.last_read_at,'-infinity'::timestamptz)
        and public.is_conversation_member(cm.conversation_id,auth.uid()))::bigint,
    (select count(*) from public.notifications n where n.user_id=auth.uid() and n.read_at is null
      and (n.actor_id is null or not public.is_blocked(n.actor_id,auth.uid())))::bigint
$$;

create or replace function public.search_authorized(p_query text,p_limit integer)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with q as (select trim(p_query) value,least(greatest(coalesce(p_limit,20),1),60) lim),
  people as (
    select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username,'avatar_key',p.avatar_key)
      order by p.display_name,p.id) value from (
      select p.* from public.profiles p,q where char_length(q.value) between 2 and 60
       and (p.id=auth.uid() or not public.is_blocked(p.id,auth.uid()))
       and (p.display_name ilike '%'||q.value||'%' or p.username ilike '%'||q.value||'%')
       order by p.display_name,p.id limit (select lim from q)
    ) p
  ), event_rows as (
    select jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'starts_at',e.starts_at,'cover_key',e.cover_key)
      order by e.starts_at desc nulls last,e.id) value from (
      select e.* from public.events e,q where char_length(q.value) between 2 and 60
       and public.can_view_event(e.id,auth.uid()) and (e.title ilike '%'||q.value||'%' or e.description ilike '%'||q.value||'%')
       order by e.starts_at desc nulls last,e.id limit (select lim from q)
    ) e
  ), post_rows as (
    select jsonb_agg(jsonb_build_object('id',p.id,'author_id',p.author_id,'caption',p.caption,'created_at',p.created_at)
      order by p.created_at desc,p.id desc) value from (
      select p.* from public.posts p,q where char_length(q.value) between 2 and 60
       and public.can_view_post(p.id,auth.uid()) and p.caption ilike '%'||q.value||'%'
       order by p.created_at desc,p.id desc limit (select lim from q)
    ) p
  )
  select case when auth.uid() is null or char_length((select value from q)) not between 2 and 60
    then jsonb_build_object('people','[]'::jsonb,'events','[]'::jsonb,'posts','[]'::jsonb)
    else jsonb_build_object('people',coalesce(people.value,'[]'::jsonb),
      'events',coalesce(event_rows.value,'[]'::jsonb),'posts',coalesce(post_rows.value,'[]'::jsonb)) end
  from people,event_rows,post_rows
$$;

-- Blocking takes conversation row locks in UUID order, then removes the blocker
-- from every shared conversation. That immediately prevents both read and send.
create or replace function public.block_member(p_blocked uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or p_blocked is null or p_blocked=v_actor then raise exception 'invalid block target'; end if;
  if not exists(select 1 from public.profiles where id=p_blocked) then raise exception 'invalid block target'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    least(v_actor::text,p_blocked::text)||':'||greatest(v_actor::text,p_blocked::text),0));
  insert into public.blocks(blocker_id,blocked_id) values(v_actor,p_blocked) on conflict do nothing;
  delete from public.friendships where (requester_id=v_actor and addressee_id=p_blocked) or (requester_id=p_blocked and addressee_id=v_actor);
  delete from public.circle_members cm using public.circles c where cm.circle_id=c.id
    and ((c.owner_id=v_actor and cm.user_id=p_blocked) or (c.owner_id=p_blocked and cm.user_id=v_actor));
  perform 1 from public.events e where
    (e.owner_id=v_actor and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=p_blocked))
    or (e.owner_id=p_blocked and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=v_actor))
    or (e.owner_id not in (v_actor,p_blocked) and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=v_actor)
      and exists(select 1 from public.event_members x where x.event_id=e.id and x.user_id=p_blocked))
    order by e.id for update;
  delete from public.event_members em using public.events e where em.event_id=e.id and em.role<>'owner' and (
    (e.owner_id=v_actor and em.user_id=p_blocked) or (e.owner_id=p_blocked and em.user_id=v_actor)
    or (e.owner_id not in (v_actor,p_blocked) and em.user_id=v_actor
      and exists(select 1 from public.event_members peer where peer.event_id=e.id and peer.user_id=p_blocked)));
  perform 1 from public.conversations c where exists(
    select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id=a.conversation_id
     where a.conversation_id=c.id and a.user_id=v_actor and b.user_id=p_blocked
  ) order by c.id for update;
  delete from public.conversation_members cm where cm.user_id=v_actor and exists(
    select 1 from public.conversation_members peer where peer.conversation_id=cm.conversation_id and peer.user_id=p_blocked);
  delete from public.notifications where user_id in (v_actor,p_blocked) and actor_id in (v_actor,p_blocked);
end $$;

revoke all on function public.create_conversation_secure(uuid[],text),
  public.list_conversations_secure(),public.mark_conversation_read_secure(uuid,timestamptz),
  public.send_message_secure(uuid,text,uuid,uuid[]),
  public.list_messages_secure(uuid,timestamptz,uuid,integer),
  public.list_notifications_secure(timestamptz,uuid,integer),
  public.mark_notification_read_secure(uuid),public.mark_all_notifications_read_secure(),
  public.unread_counts_secure(),public.search_authorized(text,integer),
  public.release_deleted_message_upload(),public.emit_communications_notification(),
  private.enqueue_notification(uuid,uuid,text,text,uuid,text),public.block_member(uuid)
from public,anon,authenticated;
grant execute on function public.create_conversation_secure(uuid[],text),
  public.list_conversations_secure(),public.mark_conversation_read_secure(uuid,timestamptz),
  public.send_message_secure(uuid,text,uuid,uuid[]),
  public.list_messages_secure(uuid,timestamptz,uuid,integer),
  public.list_notifications_secure(timestamptz,uuid,integer),
  public.mark_notification_read_secure(uuid),public.mark_all_notifications_read_secure(),
  public.unread_counts_secure(),public.search_authorized(text,integer),public.block_member(uuid)
to authenticated;