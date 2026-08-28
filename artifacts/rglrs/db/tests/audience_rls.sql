-- Run after migrations in a Supabase test project. The transaction always rolls back.
begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000001','authenticated','authenticated','rls-owner@example.test','',now(),'{}','{"full_name":"Owner"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000002','authenticated','authenticated','rls-member@example.test','',now(),'{}','{"full_name":"Member"}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-0000-0000-000000000003','authenticated','authenticated','rls-foreign@example.test','',now(),'{}','{"full_name":"Foreign"}',now(),now());

insert into public.circles(id,owner_id,name) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner circle'),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','Foreign circle');
insert into public.circle_members(circle_id,user_id)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

insert into public.events(id,owner_id,title) values
  ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner event'),
  ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','Foreign event');
insert into public.event_members(event_id,user_id)
values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');

insert into public.posts(id,author_id,caption,audience_kind) values
  ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','Circle post','circles'),
  ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Event post','events'),
  ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Rule policy post','private');
insert into public.audience_rules(post_id,rule_type,subject_id) values
  ('40000000-0000-0000-0000-000000000001','include_circle','20000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002','include_event','30000000-0000-0000-0000-000000000001');

do $$
begin
  if not public.can_view_post('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001') then
    raise exception 'circle owner could not view a member post';
  end if;
  if not public.can_view_post('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001') then
    raise exception 'event owner could not view a member post';
  end if;
  if public.can_set_audience_rule('40000000-0000-0000-0000-000000000003','include_circle','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002') then
    raise exception 'foreign circle targeting was allowed';
  end if;
  if public.can_set_audience_rule('40000000-0000-0000-0000-000000000003','include_event','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002') then
    raise exception 'foreign event targeting was allowed';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.audience_rules(post_id,rule_type,subject_id)
    values ('40000000-0000-0000-0000-000000000003','include_circle','20000000-0000-0000-0000-000000000002');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'RLS allowed a foreign circle audience rule'; end if;
end $$;

reset role;
rollback;