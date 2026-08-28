-- Private R2 upload sessions, validation metadata, atomic post claiming, and orphan cleanup.

create table if not exists public.media_uploads (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  object_key text not null unique,
  original_filename text not null check(char_length(original_filename) between 1 and 120),
  content_type text not null check(content_type in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')),
  media_type text not null check(media_type in ('image','video')),
  declared_size bigint not null check(declared_size > 0 and declared_size <= 104857600),
  validated_size bigint,
  width integer,
  height integer,
  duration_ms integer,
  status text not null default 'pending' check(status in ('pending','uploaded','claimed','failed','deleted')),
  post_id uuid references public.posts(id) on delete set null,
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_upload_dimensions check(
    (media_type='image' and duration_ms is null)
    or media_type='video'
  )
);
create index if not exists media_uploads_owner_created_idx on public.media_uploads(owner_id,created_at desc);
create index if not exists media_uploads_cleanup_idx on public.media_uploads(status,expires_at)
  where status in ('pending','uploaded','failed');
alter table public.media_uploads enable row level security;
drop policy if exists "owners read media uploads" on public.media_uploads;
create policy "owners read media uploads" on public.media_uploads for select to authenticated using(owner_id=auth.uid());
revoke all on public.media_uploads from public,anon,authenticated;
grant select on public.media_uploads to authenticated;
grant all on public.media_uploads,public.account_deletion_operations to service_role;

alter table public.post_media add column if not exists upload_id uuid;
do $$ begin
  if not exists(
    select 1 from pg_constraint
     where conname='post_media_upload_id_fkey'
       and conrelid='public.post_media'::regclass
  ) then
    alter table public.post_media add constraint post_media_upload_id_fkey
      foreign key(upload_id) references public.media_uploads(id) on delete restrict;
  end if;
  if not exists(
    select 1 from pg_constraint
     where conname='post_media_upload_id_key'
       and conrelid='public.post_media'::regclass
  ) then
    alter table public.post_media add constraint post_media_upload_id_key unique(upload_id);
  end if;
end $$;

-- Direct browser writes cannot create or retarget media records. The secure post RPC
-- is the sole insert path and claims a validated upload in the same transaction.
drop policy if exists "authors insert owned post media" on public.post_media;
drop policy if exists "authors update owned post media" on public.post_media;
drop policy if exists "authors manage post media" on public.post_media;

create or replace function public.release_deleted_post_upload()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.upload_id is not null then
    update public.media_uploads
       set status='uploaded', post_id=null, expires_at=now(), updated_at=now()
     where id=old.upload_id and status='claimed';
  end if;
  return old;
end $$;
drop trigger if exists release_deleted_post_upload on public.post_media;
create trigger release_deleted_post_upload after delete on public.post_media
for each row execute function public.release_deleted_post_upload();

create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_subject uuid;
  v_item jsonb;
  v_rule public.audience_rule_type;
  v_upload_id uuid;
  v_upload public.media_uploads%rowtype;
begin
  if auth.uid() is null or coalesce(char_length(p_caption),0)>220 or p_audience not in ('private','friends','circles','events','people','except') then raise exception 'invalid post input'; end if;
  if coalesce(jsonb_array_length(p_media),0)>8 or jsonb_typeof(coalesce(p_media,'[]'::jsonb))<>'array' then raise exception 'invalid media'; end if;
  if p_audience in ('private','friends') and coalesce(cardinality(p_subject_ids),0)<>0 then raise exception 'invalid audience subjects'; end if;
  if p_audience in ('circles','events','people','except') and coalesce(cardinality(p_subject_ids),0)=0 then raise exception 'invalid audience subjects'; end if;

  insert into public.posts(author_id,caption,audience_kind)
  values(auth.uid(),coalesce(p_caption,''),p_audience)
  returning id into v_id;

  if p_audience in ('friends','except') then
    insert into public.audience_rules(post_id,rule_type) values(v_id,'include_friends');
  end if;
  foreach v_subject in array coalesce(p_subject_ids,'{}'::uuid[]) loop
    v_rule := case p_audience
      when 'people' then 'include_user'::public.audience_rule_type
      when 'except' then 'exclude_user'::public.audience_rule_type
      when 'circles' then 'include_circle'::public.audience_rule_type
      when 'events' then 'include_event'::public.audience_rule_type
    end;
    if not public.can_set_audience_rule(v_id,v_rule,v_subject,auth.uid()) then raise exception 'invalid audience subject'; end if;
    insert into public.audience_rules(post_id,rule_type,subject_id) values(v_id,v_rule,v_subject);
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) loop
    begin
      v_upload_id := (v_item->>'upload_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid media';
    end;
    select * into v_upload
      from public.media_uploads
     where id=v_upload_id
       and owner_id=auth.uid()
       and status='uploaded'
       and expires_at>now()
     for update;
    if not found then raise exception 'invalid media'; end if;
    insert into public.post_media(
      post_id,upload_id,object_key,media_type,width,height,duration_ms,sort_order
    ) values(
      v_id,v_upload.id,v_upload.object_key,v_upload.media_type,
      v_upload.width,v_upload.height,v_upload.duration_ms,
      coalesce((v_item->>'sort_order')::int,0)
    );
    update public.media_uploads
       set status='claimed',post_id=v_id,expires_at=now()+interval '100 years',updated_at=now()
     where id=v_upload.id;
  end loop;
  return v_id;
end $$;

revoke all on function public.release_deleted_post_upload(), public.create_post_secure(text,text,uuid[],jsonb) from public,anon;
grant execute on function public.create_post_secure(text,text,uuid[],jsonb) to authenticated;