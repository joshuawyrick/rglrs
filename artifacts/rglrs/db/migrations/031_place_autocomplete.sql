alter table public.posts
  add column if not exists location_address text;

alter table public.events
  add column if not exists place_address text;

alter table public.posts
  drop constraint if exists posts_location_address_check;
alter table public.posts
  add constraint posts_location_address_check
  check (
    location_address is null
    or (
      char_length(btrim(location_address)) between 1 and 240
      and location_address=btrim(location_address)
    )
  );

alter table public.events
  drop constraint if exists events_place_address_check;
alter table public.events
  add constraint events_place_address_check
  check (
    place_address is null
    or (
      char_length(btrim(place_address)) between 1 and 240
      and place_address=btrim(place_address)
    )
  );

create or replace function public.create_post_secure(
  p_caption text,
  p_audience text,
  p_subject_ids uuid[],
  p_media jsonb,
  p_location_name text,
  p_location_address text,
  p_allow_downloads boolean
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_location_address text:=nullif(btrim(coalesce(p_location_address,'')),'');
begin
  if coalesce(char_length(v_location_address),0)>240 then
    raise exception 'invalid post input';
  end if;
  v_id:=public.create_post_secure(
    p_caption,p_audience,p_subject_ids,p_media,p_location_name,p_allow_downloads
  );
  update public.posts
     set location_address=v_location_address
   where id=v_id and author_id=auth.uid();
  return v_id;
end
$$;

create or replace function public.create_event_secure(
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_place_name text,
  p_place_address text,
  p_members_can_invite boolean
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid;
  v_place_address text:=nullif(btrim(coalesce(p_place_address,'')),'');
begin
  if coalesce(char_length(v_place_address),0)>240 then
    raise exception 'invalid event';
  end if;
  v_id:=public.create_event_secure(
    p_title,p_description,p_starts_at,p_ends_at,p_place_name,p_members_can_invite
  );
  update public.events
     set place_address=v_place_address
   where id=v_id and owner_id=auth.uid();
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
  p_members_can_invite boolean
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_updated boolean;
  v_place_address text:=nullif(btrim(coalesce(p_place_address,'')),'');
begin
  if coalesce(char_length(v_place_address),0)>240 then
    raise exception 'invalid event';
  end if;
  v_updated:=public.update_event_secure(
    p_event,p_title,p_description,p_starts_at,p_ends_at,p_place_name,p_members_can_invite
  );
  if not coalesce(v_updated,false) then return false; end if;
  update public.events e
     set place_address=v_place_address
   where e.id=p_event
     and exists(
       select 1 from public.event_members em
        where em.event_id=e.id and em.user_id=auth.uid() and em.role in ('owner','admin')
     );
  return found;
end
$$;

revoke all on function public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean),
  public.create_event_secure(text,text,timestamptz,timestamptz,text,text,boolean),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,text,boolean)
from public,anon,authenticated;

grant execute on function public.create_post_secure(text,text,uuid[],jsonb,text,text,boolean),
  public.create_event_secure(text,text,timestamptz,timestamptz,text,text,boolean),
  public.update_event_secure(uuid,text,text,timestamptz,timestamptz,text,text,boolean)
to authenticated;

insert into public.rglrs_migrations(version,filename)
values(31,'031_place_autocomplete.sql')
on conflict(version) do update set filename=excluded.filename;