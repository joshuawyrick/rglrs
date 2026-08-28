-- Cross-account coverage for profiles, posts, media, interactions, and saves.
-- Test identities use reserved .test email addresses and are rolled back.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','61000000-0000-0000-0000-000000000001','authenticated','authenticated','core-owner@example.test','',now(),'{}','{"full_name":"Core Owner"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-0000-0000-000000000002','authenticated','authenticated','core-viewer@example.test','',now(),'{}','{"full_name":"Core Viewer"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-0000-0000-000000000003','authenticated','authenticated','core-foreign@example.test','',now(),'{}','{"full_name":"Core Foreign"}',now(),now());

insert into public.posts (id, author_id, caption, audience_kind)
values ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','Private shared post','people');

insert into public.audience_rules (post_id, rule_type, subject_id)
values ('62000000-0000-0000-0000-000000000001','include_user','61000000-0000-0000-0000-000000000002');

insert into public.post_media (id, post_id, object_key, media_type)
values ('63000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','originals/61000000-0000-0000-0000-000000000001/test.jpg','image');

insert into public.comments (id, post_id, author_id, body)
values ('64000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000001','Visible comment');

set local role authenticated;
set local "request.jwt.claim.sub" = '61000000-0000-0000-0000-000000000002';

insert into public.reactions (post_id, user_id)
values ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002');
insert into public.saves (post_id, user_id)
values ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002');
insert into public.saved_collections (id, owner_id, name)
values ('65000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000002','Viewer collection');
insert into public.saved_collection_posts (collection_id, post_id)
values ('65000000-0000-0000-0000-000000000001','62000000-0000-0000-0000-000000000001');

do $$
declare
  affected integer;
  blocked boolean := false;
begin
  if (select count(*) from public.posts where id='62000000-0000-0000-0000-000000000001') <> 1
    or (select count(*) from public.post_media where id='63000000-0000-0000-0000-000000000001') <> 1
    or (select count(*) from public.comments where id='64000000-0000-0000-0000-000000000001') <> 1
  then
    raise exception 'authorized viewer could not read shared post content';
  end if;

  if (select count(*) from public.saves where user_id='61000000-0000-0000-0000-000000000002') <> 1
    or (select count(*) from public.saved_collections where owner_id='61000000-0000-0000-0000-000000000002') <> 1
  then
    raise exception 'viewer could not read account-owned save data';
  end if;

  begin
    update public.profiles
       set display_name='Unauthorized edit'
     where id='61000000-0000-0000-0000-000000000001';
    get diagnostics affected = row_count;
  exception when insufficient_privilege then
    affected := 0;
  end;
  if affected <> 0 then
    raise exception 'viewer updated another profile';
  end if;

  begin
    insert into public.reactions(post_id,user_id)
    values ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000003');
  exception
    when insufficient_privilege or check_violation then blocked := true;
    when sqlstate 'P0001' then
      if position('actor mismatch' in sqlerrm)>0 then blocked := true; else raise; end if;
  end;
  if not blocked then
    raise exception 'viewer forged a reaction for another account';
  end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '61000000-0000-0000-0000-000000000003';

do $$
declare
  blocked boolean := false;
begin
  if (select count(*) from public.posts where id='62000000-0000-0000-0000-000000000001') <> 0
    or (select count(*) from public.post_media where id='63000000-0000-0000-0000-000000000001') <> 0
    or (select count(*) from public.comments where id='64000000-0000-0000-0000-000000000001') <> 0
    or (select count(*) from public.reactions where post_id='62000000-0000-0000-0000-000000000001') <> 0
  then
    raise exception 'unrelated account could read private post content';
  end if;

  if (select count(*) from public.saves) <> 0
    or (select count(*) from public.saved_collections) <> 0
    or (select count(*) from public.saved_collection_posts) <> 0
  then
    raise exception 'unrelated account could read account-owned saved data';
  end if;

  begin
    insert into public.comments(post_id,author_id,body)
    values ('62000000-0000-0000-0000-000000000001','61000000-0000-0000-0000-000000000003','Unauthorized comment');
  exception when insufficient_privilege or check_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'unrelated account commented on an inaccessible post';
  end if;
end $$;

reset role;
set local role anon;

do $$
begin
  begin
    if (select count(*) from public.profiles) <> 0
      or (select count(*) from public.posts) <> 0
      or (select count(*) from public.post_media) <> 0
    then
      raise exception 'anonymous role received private rows';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;
rollback;