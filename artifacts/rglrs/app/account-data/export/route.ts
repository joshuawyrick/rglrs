import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ownPosts = await supabase.from("posts").select("*").eq("author_id", user.id);
  if (ownPosts.error) return NextResponse.json({ error: "Could not prepare export" }, { status: 500 });
  const postIds = ownPosts.data.map((post) => post.id);
  const memberships = await supabase.from("conversation_members").select("*").eq("user_id", user.id);
  if (memberships.error) return NextResponse.json({ error: "Could not prepare export" }, { status: 500 });
  const conversationIds = memberships.data?.map((membership) => membership.conversation_id) ?? [];
  const [profile, media, comments, reactions, saves, collections, collectionPosts, friendships, circles, circleMembers, events, eventMembers, messages, notifications, reports, blocks, audienceRules] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    postIds.length ? supabase.from("post_media").select("id,post_id,upload_id,media_type,width,height,duration_ms,sort_order,created_at").in("post_id", postIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("comments").select("*").eq("author_id", user.id),
    supabase.from("reactions").select("*").eq("user_id", user.id),
    supabase.from("saves").select("*").eq("user_id", user.id),
    supabase.from("saved_collections").select("*").eq("owner_id", user.id),
    supabase.from("saved_collection_posts").select("*"),
    supabase.from("friendships").select("*").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
    supabase.from("circles").select("*").eq("owner_id", user.id),
    supabase.from("circle_members").select("*").eq("user_id", user.id),
    supabase.from("events").select("*").eq("owner_id", user.id),
    supabase.from("event_members").select("*").eq("user_id", user.id),
    conversationIds.length ? supabase.from("messages").select("*").in("conversation_id", conversationIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("notifications").select("*").eq("user_id", user.id),
    supabase.from("reports").select("id,target_id,target_post_id,target_comment_id,target_snapshot_id,category,details,status,created_at,reviewed_at").eq("reporter_id", user.id),
    supabase.from("blocks").select("blocked_id,created_at").eq("blocker_id", user.id),
    postIds.length ? supabase.from("audience_rules").select("*").in("post_id", postIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([profile, media, comments, reactions, saves, collections, collectionPosts, friendships, circles, circleMembers, events, eventMembers, messages, notifications, reports, blocks, audienceRules].some((result) => result.error)) {
    return NextResponse.json({ error: "Could not prepare a complete export" }, { status: 500 });
  }
  const payload = {
    exported_at: new Date().toISOString(), account: { id: user.id, email: user.email, created_at: user.created_at, email_confirmed_at: user.email_confirmed_at },
    profile: profile.data, posts: ownPosts.data, media: media.data ?? [], comments: comments.data ?? [], reactions: reactions.data ?? [], saves: saves.data ?? [],
    collections: collections.data ?? [], collection_posts: collectionPosts.data ?? [], friendships: friendships.data ?? [], circles: circles.data ?? [], circle_memberships: circleMembers.data ?? [],
    events: events.data ?? [], event_memberships: eventMembers.data ?? [], conversation_memberships: memberships.data ?? [], messages: messages.data ?? [], notifications: notifications.data ?? [], reports: reports.data ?? [],
    blocks: blocks.data ?? [], audience_rules: audienceRules.data ?? [],
  };
  return new NextResponse(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="rglrs-account-export.json"', "Cache-Control": "no-store" } });
}