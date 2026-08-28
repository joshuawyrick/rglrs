-- Run after migrations in a Supabase test project. The transaction always rolls back.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000001','authenticated','authenticated','collection-owner@example.test','',now(),'{}','{"full_name":"Collection Owner"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000002','authenticated','authenticated','collection-author@example.test','',now(),'{}','{"full_name":"Post Author"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','51000000-0000-0000-0000-000000000003','authenticated','authenticated','collection-foreign@example.test','',now(),'{}','{"full_name":"Foreign User"}',now(),now());

insert into public.posts(id,author_id,caption,audience_kind)
values ('52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','Visible saved post','people');
insert into public.audience_rules(post_id,rule_type,subject_id)
values ('52000000-0000-0000-0000-000000000001','include_user','51000000-0000-0000-0000-000000000001');
insert into public.saves(post_id,user_id)
values ('52000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001');
insert into public.saved_collections(id,owner_id,name)
values ('53000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','Private trip');
insert into public.saved_collection_posts(collection_id,post_id)
values ('53000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001');

set local role authenticated;
set local "request.jwt.claim.sub" = '51000000-0000-0000-0000-000000000001';

do $$
begin
  if (select count(*) from public.saved_collections) <> 1 then
    raise exception 'collection owner could not read their collection';
  end if;
  if (select count(*) from public.saved_collection_posts) <> 1 then
    raise exception 'collection owner could not read visible saved membership';
  end if;
end $$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '51000000-0000-0000-0000-000000000003';

do $$
begin
  if (select count(*) from public.saved_collections) <> 0 then
    raise exception 'foreign user could read a private collection';
  end if;
  if (select count(*) from public.saved_collection_posts) <> 0 then
    raise exception 'foreign user could read private collection membership';
  end if;
end $$;

reset role;
delete from public.audience_rules
where post_id='52000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" = '51000000-0000-0000-0000-000000000001';

do $$
begin
  if (select count(*) from public.saved_collection_posts) <> 0 then
    raise exception 'inaccessible post membership leaked through collection RLS';
  end if;
  if (select count(*) from public.posts where id='52000000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'inaccessible saved post bypassed post RLS';
  end if;
end $$;

reset role;
delete from public.saves
where post_id='52000000-0000-0000-0000-000000000001'
  and user_id='51000000-0000-0000-0000-000000000001';

do $$
begin
  if (select count(*) from public.saved_collection_posts) <> 0 then
    raise exception 'unsaving did not remove collection membership';
  end if;
end $$;

rollback;