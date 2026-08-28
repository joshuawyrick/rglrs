-- Keep private storage keys out of browser-readable message media rows.
-- The protected media route authorizes the row with the caller session first,
-- then resolves object_key through the server-only service role.

revoke select on public.message_media from public,anon,authenticated;
grant select(
  id,message_id,sender_id,media_type,width,height,duration_ms,sort_order,created_at
) on public.message_media to authenticated;
grant select on public.message_media to service_role;