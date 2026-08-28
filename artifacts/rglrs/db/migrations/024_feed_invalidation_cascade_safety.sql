-- Account deletion cascades relationship rows after the profile has stopped
-- being a valid invalidation recipient. Skip those disappearing recipients.

create or replace function public.emit_private_feed_invalidation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_left uuid; v_right uuid; v_reason text;
begin
  if tg_table_name='friendships' then
    v_left:=coalesce(new.requester_id,old.requester_id);
    v_right:=coalesce(new.addressee_id,old.addressee_id);
    v_reason:='friendship';
  elsif tg_table_name='blocks' then
    v_left:=coalesce(new.blocker_id,old.blocker_id);
    v_right:=coalesce(new.blocked_id,old.blocked_id);
    v_reason:='block';
  else
    raise exception 'invalid feed invalidation source';
  end if;
  insert into public.feed_invalidations(user_id,reason)
  select x,v_reason
  from unnest(array[v_left,v_right]) x
  join public.profiles p on p.id=x
  where x is not null;
  return coalesce(new,old);
end
$$;

revoke all on function public.emit_private_feed_invalidation() from public,anon,authenticated;