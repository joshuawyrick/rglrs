alter table public.profiles
  add column if not exists is_founder boolean not null default false;

comment on column public.profiles.is_founder is
  'Server-managed founding member badge; never writable through the user profile RPC.';