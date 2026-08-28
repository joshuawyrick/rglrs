alter table public.profiles
  add column if not exists avatar_upload_id uuid;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname='profiles_avatar_upload_id_fkey'
       and conrelid='public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_avatar_upload_id_fkey
      foreign key(avatar_upload_id) references public.media_uploads(id) on delete set null;
  end if;
end $$;

create or replace function public.update_profile_secure(
  p_display_name text,
  p_username text,
  p_bio text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null
     or p_display_name is null
     or char_length(btrim(p_display_name)) not between 1 and 80
     or p_username is null
     or btrim(p_username) !~ '^[a-z0-9_]{3,30}$'
     or char_length(coalesce(p_bio,'')) > 240
  then raise exception 'invalid profile input'; end if;

  update public.profiles
     set display_name=btrim(p_display_name),
         username=btrim(p_username),
         bio=btrim(coalesce(p_bio,'')),
         updated_at=now()
   where id=auth.uid();
  if not found then raise exception 'profile not found'; end if;
end $$;

create or replace function public.set_profile_avatar_secure(
  p_upload_id uuid
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=auth.uid();
  v_previous uuid;
  v_upload public.media_uploads%rowtype;
  v_avatar_key text;
begin
  if v_actor is null then raise exception 'not authenticated'; end if;

  select avatar_upload_id into v_previous
    from public.profiles
   where id=v_actor
   for update;
  if not found then raise exception 'profile not found'; end if;

  if p_upload_id is null then
    update public.profiles
       set avatar_key=null, avatar_upload_id=null, updated_at=now()
     where id=v_actor;
    if v_previous is not null then
      update public.media_uploads
         set status='uploaded', expires_at=now(), updated_at=now()
       where id=v_previous and owner_id=v_actor and status='claimed'
         and post_id is null and message_id is null;
    end if;
    return null;
  end if;

  select * into v_upload
    from public.media_uploads
   where id=p_upload_id
     and owner_id=v_actor
     and media_type='image'
     and status='uploaded'
     and expires_at>now()
   for update;
  if not found then raise exception 'invalid profile image upload'; end if;

  v_avatar_key:='/private-media/avatar/'||v_upload.id::text;
  update public.profiles
     set avatar_key=v_avatar_key, avatar_upload_id=v_upload.id, updated_at=now()
   where id=v_actor;
  update public.media_uploads
     set status='claimed', post_id=null, message_id=null,
         expires_at=now()+interval '100 years', updated_at=now()
   where id=v_upload.id;

  if v_previous is not null and v_previous<>v_upload.id then
    update public.media_uploads
       set status='uploaded', expires_at=now(), updated_at=now()
     where id=v_previous and owner_id=v_actor and status='claimed'
       and post_id is null and message_id is null;
  end if;
  return v_avatar_key;
end $$;

revoke update on public.profiles from authenticated;
revoke all on function public.update_profile_secure(text,text,text),
  public.set_profile_avatar_secure(uuid) from public,anon,authenticated;
grant execute on function public.update_profile_secure(text,text,text),
  public.set_profile_avatar_secure(uuid) to authenticated;