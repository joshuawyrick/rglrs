-- One-use retry regression. The invite row lock in the RPC is the concurrency
-- boundary: a simultaneous retry waits, then observes this same redemption.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','93500000-0000-0000-0000-000000000001','authenticated','authenticated','signup-inviter@example.test','',now(),'{}','{"full_name":"Inviter"}',now(),now()),
('00000000-0000-0000-0000-000000000000','93500000-0000-0000-0000-000000000002','authenticated','authenticated','signup-retry@example.test','',now(),'{}','{"full_name":"Retry"}',now(),now()),
('00000000-0000-0000-0000-000000000000','93500000-0000-0000-0000-000000000003','authenticated','authenticated','signup-other@example.test','',now(),'{}','{"full_name":"Other"}',now(),now());

insert into public.signup_invites(created_by,token_hash,expires_at,max_uses)
values('93500000-0000-0000-0000-000000000001',repeat('d',64),now()+interval '1 day',1);

set local role authenticated;
set local "request.jwt.claim.sub"='93500000-0000-0000-0000-000000000002';
do $$
begin
  if public.redeem_signup_invite_secure(repeat('d',64)) <> '93500000-0000-0000-0000-000000000001'::uuid
     or public.redeem_signup_invite_secure(repeat('d',64)) <> '93500000-0000-0000-0000-000000000001'::uuid
  then raise exception 'one-use invite retry was not idempotent after capacity'; end if;
end $$;

reset role;
do $$
begin
  if (select use_count from public.signup_invites where token_hash=repeat('d',64)) <> 1
     or (select count(*) from public.signup_invite_redemptions where user_id='93500000-0000-0000-0000-000000000002') <> 1
  then raise exception 'retry incremented one-use invitation more than once'; end if;
end $$;

set local role authenticated;
set local "request.jwt.claim.sub"='93500000-0000-0000-0000-000000000003';
do $$
begin
  if public.redeem_signup_invite_secure(repeat('d',64)) is not null then
    raise exception 'one-use invitation admitted another recipient';
  end if;
end $$;

reset role;
rollback;