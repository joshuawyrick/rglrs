-- Friend-network reads are RPC-only so relationship metadata and feed paging
-- remain consistent with the live authorization helpers.

create or replace function public.list_friendships_secure()
returns table(
  friendship_id uuid,
  status public.friendship_status,
  direction text,
  profile_id uuid,
  display_name text,
  username text,
  avatar_key text,
  created_at timestamptz,
  updated_at timestamptz
) language sql stable security definer set search_path=public,pg_temp as $$
  select
    f.id,
    f.status,
    case
      when f.status='accepted' then 'friend'
      when f.addressee_id=auth.uid() then 'incoming'
      else 'outgoing'
    end,
    p.id,
    p.display_name,
    p.username,
    p.avatar_key,
    f.created_at,
    f.updated_at
  from public.friendships f
  join public.profiles p on p.id=case
    when f.requester_id=auth.uid() then f.addressee_id
    else f.requester_id
  end
  where auth.uid() is not null
    and auth.uid() in (f.requester_id,f.addressee_id)
    and f.status in ('accepted','pending')
    and not public.is_blocked(f.requester_id,f.addressee_id)
  order by
    case when f.status='pending' and f.addressee_id=auth.uid() then 0
         when f.status='accepted' then 1 else 2 end,
    f.updated_at desc,
    f.id desc
$$;

-- Visibility is evaluated before the cursor and limit.  In particular, do
-- not page over raw posts and filter the resulting page in the application:
-- private newer posts must not starve an older authorized post.
create or replace function public.list_feed_page_secure(
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns table(
  id uuid,
  author_id uuid,
  caption text,
  audience_kind text,
  location_name text,
  created_at timestamptz
) language sql stable security definer set search_path=public,pg_temp as $$
  select p.id,p.author_id,p.caption,p.audience_kind,p.location_name,p.created_at
  from public.posts p
  where auth.uid() is not null
    and public.can_view_post(p.id,auth.uid())
    and not public.is_blocked(p.author_id,auth.uid())
    and (
      p_before_created_at is null
      or (p.created_at,p.id)<(
        p_before_created_at,
        coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
      )
    )
  order by p.created_at desc,p.id desc
  limit least(greatest(coalesce(p_limit,10),1),100)+1
$$;

-- Keep relationship mutations RPC-only, and make the callable surface
-- explicit rather than inheriting default PUBLIC function privileges.
revoke all on function public.create_friend_request_secure(uuid),
  public.respond_friend_request_secure(uuid,text),
  public.remove_friendship_secure(uuid),
  public.list_friendships_secure(),
  public.list_feed_page_secure(timestamptz,uuid,integer)
from public,anon,authenticated;

grant execute on function public.create_friend_request_secure(uuid),
  public.respond_friend_request_secure(uuid,text),
  public.remove_friendship_secure(uuid),
  public.list_friendships_secure(),
  public.list_feed_page_secure(timestamptz,uuid,integer)
to authenticated;