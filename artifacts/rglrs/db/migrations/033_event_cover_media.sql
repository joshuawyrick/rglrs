-- Private event covers and timezone-aware event details.
-- Existing event RPC signatures remain available for older clients.

alter table public.events
  add column if not exists cover_upload_id uuid,
  add column if not exists all_day boolean not null default false,
  add column if not exists timezone text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname='events_cover_upload_id_fkey'
       and conrelid='public.events'::regclass
  ) then
    alter table public.events add constraint events_cover_upload_id_fkey
      foreign key(cover_upload_id) references public.media_uploads(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname='events_timezone_check'
       and conrelid='public.events'::regclass
  ) then
    alter table public.events add constraint events_timezone_check
      check(timezone is null or (timezone=btrim(timezone) and char_length(timezone) between 1 and 100));
  end if;
end $$;

create unique index if not exists events_cover_upload_id_key
  on public.events(cover_upload_id) where cover_upload_id is not null;

create or replace function public.release_event_cover_upload()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.cover_upload_id is not null
     and (tg_op='DELETE' or new.cover_upload_id is distinct from old.cover_upload_id)
  then
    update public.media_uploads
       set status='uploaded',
           expires_at=now()+interval '30 days',
           updated_at=now()
     where id=old.cover_upload_id
       and status='claimed'
       and post_id is null
       and message_id is null;
  end if;
  return case when tg_op='DELETE' then old else new end;
end
$$;

drop trigger if exists release_event_cover_upload on public.events;
create trigger release_event_cover_upload
after update of cover_upload_id or delete on public.events
for each row execute function public.release_event_cover_upload();

create or replace function public.create_event_secure(
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_place_name text,
  p_place_address text,
  p_members_can_invite boolean,
  p_all_day boolean,
  p_timezone text,
  p_cover_upload_id uuid
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_upload public.media_uploads%rowtype;
  v_timezone text:=nullif(btrim(coalesce(p_timezone,'')),'');
begin
  if coalesce(char_length(v_timezone),0)>100
     or (v_timezone is not null and not exists(select 1 from pg_timezone_names where name=v_timezone))
     or (coalesce(p_all_day,false) and p_starts_at is null)
  then raise exception 'invalid event'; end if;

  v_id:=public.create_event_secure(
    p_title,p_description,p_starts_at,p_ends_at,p_place_name,p_place_address,p_members_can_invite
  );

  if p_cover_upload_id is not null then
    select * into v_upload
      from public.media_uploads
     where id=p_cover_upload_id
       and owner_id=auth.uid()
       and media_type='image'
       and status='uploaded'
       and expires_at>now()
     for update;
    if not found then raise exception 'invalid event cover'; end if;
    update public.media_uploads
       set status='claimed',post_id=null,message_id=null,
           expires_at=now()+interval '100 years',updated_at=now()
     where id=v_upload.id;
  end if;

  update public.events
     set all_day=coalesce(p_all_day,false),
         timezone=v_timezone,
         cover_upload_id=p_cover_upload_id,
         cover_key=case when p_cover_upload_id is null then null
                        else '/private-media/event-cover/'||v_id::text end
   where id=v_id;
  return v_id;
end
$$;

create or replace function public.update_event_secure(
  p_event uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_place_name text,
  p_place_address text,
  p_members_can_invite boolean,
  p_all_day boolean,
  p_timezone text,
  p_cover_upload_id uuid
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_updated boolean;
  v_current_cover uuid;
  v_upload public.media_uploads%rowtype;
  v_timezone text:=nullif(btrim(coalesce(p_timezone,'')),'');
begin
  if coalesce(char_length(v_timezone),0)>100
     or (v_timezone is not null and not exists(select 1 from pg_timezone_names where name=v_timezone))
     or (coalesce(p_all_day,false) and p_starts_at is null)
  then raise exception 'invalid event'; end if;

  select e.cover_upload_id into v_current_cover
    from public.events e
   where e.id=p_event
     and exists(
       select 1 from public.event_members em
        where em.event_id=e.id and em.user_id=auth.uid() and em.role in ('owner','admin')
     )
   for update;
  if not found then return false; end if;

  v_updated:=public.update_event_secure(
    p_event,p_title,p_description,p_starts_at,p_ends_at,p_place_name,p_place_address,p_members_can_invite
  );
  if not coalesce(v_updated,false) then return false; end if;

  if p_cover_upload_id is not null and p_cover_upload_id is distinct from v_current_cover then
    select * into v_upload
      from public.media_uploads
     where id=p_cover_upload_id
       and owner_id=auth.uid()
       and media_type='image'
       and status='uploaded'
       and expires_at>now()
     for update;
    if not found then raise exception 'invalid event cover'; end if;
    update public.media_uploads
       set status='claimed',post_id=null,message_id=null,
           expires_at=now()+interval '100 years',updated_at=now()
     where id=v_upload.id;
  end if;

  update public.events
     set all_day=coalesce(p_all_day,false),
         timezone=v_timezone,
         cover_upload_id=p_cover_upload_id,
         cover_key=case when p_cover_upload_id is null and v_current_cover is null then cover_key
                        when p_cover_upload_id is null then null
                        else '/private-media/event-cover/'||p_event::text end
   where id=p_event;
  return true;
end
$$;

create or replace function public.update_event_secure(
  p_event uuid,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_place_name text,
  p_place_address text,
  p_members_can_invite boolean,
  p_all_day boolean,
  p_timezone text,
  p_cover_upload_id uuid,
  p_clear_cover boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_updated boolean;
begin
  if coalesce(p_clear_cover,false) and p_cover_upload_id is not null then
    raise exception 'invalid event cover';
  end if;
  v_updated:=public.update_event_secure(
    p_event,p_title,p_description,p_starts_at,p_ends_at,p_place_name,p_place_address,
    p_members_can_invite,p_all_day,p_timezone,p_cover_upload_id
  );
  if v_updated and coalesce(p_clear_cover,false) then
    update public.events set cover_key=null where id=p_event;
  end if;
  return v_updated;
end
$$;

revoke all on function public.release_event_cover_upload(),
  public.create_event_secure(text,text,timestamptz,timestamptz,text,text,boolean,boolean,text,uuid),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,text,boolean,boolean,text,uuid),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,text,boolean,boolean,text,uuid,boolean)
from public,anon,authenticated;

grant execute on function
  public.create_event_secure(text,text,timestamptz,timestamptz,text,text,boolean,boolean,text,uuid),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,text,boolean,boolean,text,uuid),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,text,boolean,boolean,text,uuid,boolean)
to authenticated;

insert into public.rglrs_migrations(version,filename)
values(33,'033_event_cover_media.sql')
on conflict(version) do update set filename=excluded.filename;