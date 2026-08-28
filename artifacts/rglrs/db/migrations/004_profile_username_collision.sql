-- Bring existing projects onto the collision-safe profile username trigger.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  requested_username text;
  profile_username text;
begin
  requested_username := lower(
    regexp_replace(
      coalesce(new.raw_user_meta_data->>'username',''),
      '[^a-z0-9_]',
      '',
      'g'
    )
  );

  if requested_username ~ '^[a-z0-9_]{3,30}$' then
    -- Serialize signups competing for the same requested username.
    perform pg_advisory_xact_lock(hashtextextended(requested_username, 0));
    if not exists (
      select 1
      from public.profiles
      where username=requested_username
    ) then
      profile_username := requested_username;
    else
      profile_username := 'user_' || left(md5(new.id::text),25);
    end if;
  else
    profile_username := 'user_' || left(md5(new.id::text),25);
  end if;

  insert into public.profiles(id, username, display_name)
  values (
    new.id,
    profile_username,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),'New RGLR')
  );
  return new;
end $$;