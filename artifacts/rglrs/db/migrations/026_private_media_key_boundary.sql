-- Keep private storage keys out of browser-readable post media rows.
-- Server-side service-role reads retain access for protected media routes.

revoke select on public.post_media from public,anon,authenticated;
grant select(
  id,post_id,upload_id,media_type,width,height,duration_ms,sort_order,created_at
) on public.post_media to authenticated;
grant select on public.post_media to service_role;

-- Message media is also resolved by the protected media route. Keep its
-- server-side lookup explicit so the route never needs a browser key read.
grant select on public.message_media to service_role;