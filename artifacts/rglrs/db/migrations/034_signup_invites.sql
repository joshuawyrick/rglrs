-- General RGLRS invitations. Plaintext invite tokens never cross the SQL
-- boundary: callers generate a random token and pass only its SHA-256 digest.

create table public.signup_invites (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  label text check(label is null or char_length(label) between 1 and 80),
  expires_at timestamptz not null,
  max_uses integer check(max_uses is null or max_uses between 1 and 10000),
  use_count integer not null default 0 check(use_count>=0),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at<=created_at+interval '1 year')
);

create table public.signup_invite_redemptions (
  invite_id uuid not null references public.signup_invites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key(invite_id,user_id)
);

create index signup_invites_creator_created_idx
  on public.signup_invites(created_by,created_at desc);
create index signup_invite_redemptions_user_idx
  on public.signup_invite_redemptions(user_id,redeemed_at desc);

alter table public.signup_invites enable row level security;
alter table public.signup_invite_redemptions enable row level security;
revoke all on public.signup_invites,public.signup_invite_redemptions from public,anon,authenticated;
grant select,insert,update,delete on public.signup_invites,public.signup_invite_redemptions to service_role;

create or replace function public.create_signup_invite_secure(
  p_token_hash text,p_label text,p_expires_at timestamptz,p_max_uses integer
) returns uuid language plpgsql security definer set search_path=public,private,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '1 year'
     or (p_label is not null and char_length(trim(p_label)) not between 1 and 80)
     or (p_max_uses is not null and p_max_uses not between 1 and 10000)
  then raise exception 'invalid signup invite'; end if;
  perform private.enforce_write_rate(auth.uid(),'signup_invites',30);
  insert into public.signup_invites(created_by,token_hash,label,expires_at,max_uses)
  values(auth.uid(),p_token_hash,nullif(trim(p_label),''),p_expires_at,p_max_uses)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.list_signup_invites_secure()
returns table(
  id uuid,label text,expires_at timestamptz,max_uses integer,use_count integer,
  revoked_at timestamptz,created_at timestamptz
) language sql stable security definer set search_path=public,pg_temp as $$
  select i.id,i.label,i.expires_at,i.max_uses,i.use_count,i.revoked_at,i.created_at
    from public.signup_invites i
   where i.created_by=auth.uid()
   order by i.created_at desc;
$$;

create or replace function public.revoke_signup_invite_secure(p_invite uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.signup_invites set revoked_at=coalesce(revoked_at,now())
   where id=p_invite and created_by=auth.uid() returning id into v_id;
  return v_id is not null;
end $$;

create or replace function public.redeem_signup_invite_secure(p_token_hash text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_inv public.signup_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into v_inv from public.signup_invites
   where token_hash=p_token_hash for update;
  if not found or v_inv.revoked_at is not null or v_inv.expires_at<=now()
     or public.is_blocked(v_inv.created_by,auth.uid())
  then return null; end if;
  if v_inv.created_by=auth.uid() then return v_inv.created_by; end if;
  -- The invite-row lock serializes same-token redemptions. A retried
  -- redemption must remain successful even after a one-use invite is full.
  if exists(
    select 1 from public.signup_invite_redemptions r
     where r.invite_id=v_inv.id and r.user_id=auth.uid()
  ) then return v_inv.created_by; end if;
  if v_inv.max_uses is not null and v_inv.use_count>=v_inv.max_uses
  then return null; end if;
  insert into public.signup_invite_redemptions(invite_id,user_id)
  values(v_inv.id,auth.uid()) on conflict do nothing;
  if found then
    update public.signup_invites set use_count=use_count+1 where id=v_inv.id;
  end if;
  return v_inv.created_by;
end $$;

revoke all on function public.create_signup_invite_secure(text,text,timestamptz,integer),
  public.list_signup_invites_secure(),public.revoke_signup_invite_secure(uuid),
  public.redeem_signup_invite_secure(text) from public,anon,authenticated;
grant execute on function public.create_signup_invite_secure(text,text,timestamptz,integer),
  public.list_signup_invites_secure(),public.revoke_signup_invite_secure(uuid),
  public.redeem_signup_invite_secure(text) to authenticated;

insert into public.rglrs_migrations(version,filename)
values(34,'034_signup_invites.sql')
on conflict(version) do update set filename=excluded.filename;