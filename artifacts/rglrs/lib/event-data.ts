import type { SupabaseClient } from "@supabase/supabase-js";

export type EventSummary = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  placeName: string | null;
  placeAddress: string | null;
  coverUrl: string | null;
  coverUploadId: string | null;
  allDay: boolean;
  timezone: string | null;
  membersCanInvite: boolean;
  memberCount: number;
  avatars: string[];
  currentRole: "owner" | "admin" | "member" | "viewer" | null;
  currentParticipationMode: "participate" | "upload_only" | "view_only" | null;
};

export type EventMember = {
  id: string;
  name: string;
  username: string;
  avatar: string;
  role: "owner" | "admin" | "member" | "viewer";
  participationMode: "participate" | "upload_only" | "view_only";
};

export type EventPost = {
  id: string;
  authorId: string;
  eventId: string;
  author: { name: string; username: string; avatar: string };
  time: string;
  createdAt: string;
  audience: string;
  locationName: string | null;
  locationAddress: string | null;
  image: string | null;
  mediaType: "image" | "video" | null;
  caption: string;
  likes: number;
  comments: number;
  liked: boolean;
  saved: boolean;
  allowDownloads: boolean;
  carousel: string | null;
  media: Array<{ id: string; url: string; mediaType: "image" | "video" }>;
};

type EventRow = {
  id: string; owner_id: string; title: string; description: string | null;
  starts_at: string | null; ends_at: string | null; place_name: string | null; place_address: string | null;
  cover_key: string | null; cover_upload_id: string | null; all_day: boolean; timezone: string | null; members_can_invite: boolean;
};

const avatar = (key: string | null, name: string) =>
  key?.startsWith("http") || key?.startsWith("/private-media/") ? key : `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`;

export function formatEventDate(start: string | null, end?: string | null, allDay = false, timezone?: string | null) {
  if (!start) return "Date to be announced";
  const first = new Date(start);
  const zone = timezone || undefined;
  const date = first.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone:zone });
  if (allDay) {
    if (!end) return `${date} · All day`;
    return `${date} – ${new Date(end).toLocaleDateString(undefined, { month:"short", day:"numeric", timeZone:zone })} · All day`;
  }
  const time = first.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone:zone });
  if (!end) return `${date} · ${time}`;
  const last = new Date(end);
  return `${date} · ${time} – ${last.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone:zone })}`;
}

function relative(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

async function enrichEvents(supabase: SupabaseClient, rows: EventRow[], userId: string): Promise<EventSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const { data: memberships, error } = await supabase
    .from("event_members").select("event_id,user_id,role,participation_mode").in("event_id", ids);
  if (error) throw new Error(error.message);
  const memberRows = (memberships || []) as { event_id: string; user_id: string; role: EventMember["role"]; participation_mode: EventMember["participationMode"] }[];
  const profileIds = [...new Set(memberRows.map((member) => member.user_id))];
  const profilesResult = profileIds.length
    ? await supabase.from("profiles").select("id,display_name,avatar_key").in("id", profileIds)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  const profiles = (profilesResult.data || []) as { id: string; display_name: string; avatar_key: string | null }[];
  return rows.map((row) => {
    const members = memberRows.filter((member) => member.event_id === row.id);
    const current = members.find((member) => member.user_id === userId);
    return {
      id: row.id, ownerId: row.owner_id, title: row.title, description: row.description || "",
      startsAt: row.starts_at, endsAt: row.ends_at, placeName: row.place_name, placeAddress: row.place_address,
      coverUrl: row.cover_upload_id ? `/private-media/event-cover/${row.id}` : row.cover_key?.startsWith("http") ? row.cover_key : null,
      coverUploadId: row.cover_upload_id,
      allDay: row.all_day,
      timezone: row.timezone,
      membersCanInvite: row.members_can_invite,
      memberCount: members.length,
      avatars: members.slice(0, 6).map((member) => {
        const profile = profiles.find((item) => item.id === member.user_id);
        return avatar(profile?.avatar_key || null, profile?.display_name || member.user_id);
      }),
      currentRole: row.owner_id === userId ? "owner" : current?.role || null,
      currentParticipationMode: current?.participation_mode || (row.owner_id === userId ? "participate" : null),
    };
  });
}

export async function getEvents(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.from("events")
    .select("id,owner_id,title,description,starts_at,ends_at,place_name,place_address,cover_key,cover_upload_id,all_day,timezone,members_can_invite")
    .order("starts_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return enrichEvents(supabase, (data || []) as EventRow[], userId);
}

export async function getEvent(supabase: SupabaseClient, userId: string, eventId: string) {
  const { data, error } = await supabase.from("events")
    .select("id,owner_id,title,description,starts_at,ends_at,place_name,place_address,cover_key,cover_upload_id,all_day,timezone,members_can_invite")
    .eq("id", eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return (await enrichEvents(supabase, [data as EventRow], userId))[0] || null;
}

export async function getEventMembers(supabase: SupabaseClient, eventId: string): Promise<EventMember[]> {
  const { data, error } = await supabase.from("event_members")
    .select("user_id,role,participation_mode").eq("event_id", eventId).order("joined_at");
  if (error) throw new Error(error.message);
  const rows = (data || []) as { user_id: string; role: EventMember["role"]; participation_mode: EventMember["participationMode"] }[];
  if (!rows.length) return [];
  const profilesResult = await supabase.from("profiles")
    .select("id,display_name,username,avatar_key").in("id", rows.map((row) => row.user_id));
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  return rows.map((row) => {
    const profile = (profilesResult.data || []).find((item) => item.id === row.user_id);
    return {
      id: row.user_id, name: profile?.display_name || "RGLR", username: profile?.username || "",
      avatar: avatar(profile?.avatar_key || null, profile?.display_name || row.user_id), role: row.role,
      participationMode: row.participation_mode || "participate",
    };
  });
}

export async function getEventPosts(supabase: SupabaseClient, eventId: string, userId: string): Promise<EventPost[]> {
  const { data, error } = await supabase.from("posts")
    .select("id,author_id,event_id,caption,location_name,location_address,allow_downloads,created_at").eq("event_id", eventId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const posts = (data || []) as { id: string; author_id: string; event_id: string; caption: string | null; location_name: string | null; location_address: string | null; allow_downloads: boolean; created_at: string }[];
  if (!posts.length) return [];
  const ids = posts.map((post) => post.id);
  const authorIds = [...new Set(posts.map((post) => post.author_id))];
  const [profiles, media, reactions, saves, comments] = await Promise.all([
    supabase.from("profiles").select("id,display_name,username,avatar_key").in("id", authorIds),
    supabase.from("post_media").select("id,post_id,media_type,sort_order").in("post_id", ids).order("sort_order"),
    supabase.from("reactions").select("post_id,user_id").in("post_id", ids),
    supabase.from("saves").select("post_id,user_id").eq("user_id", userId).in("post_id", ids),
    supabase.from("comments").select("post_id").in("post_id", ids),
  ]);
  const failure = [profiles, media, reactions, saves, comments].find((result) => result.error);
  if (failure?.error) throw new Error(failure.error.message);
  return posts.map((post) => {
    const profile = (profiles.data || []).find((item) => item.id === post.author_id);
    const assets = (media.data || []).filter((item) => item.post_id === post.id);
    const hydrated = assets.map((item) => ({
      id: item.id, mediaType: item.media_type as "image" | "video",
      url: `/private-media/${item.id}`,
    }));
    return {
      id: post.id, authorId: post.author_id, eventId: post.event_id,
      author: { name: profile?.display_name || "RGLR", username: profile?.username || "", avatar: avatar(profile?.avatar_key || null, profile?.display_name || post.author_id) },
      time: relative(post.created_at), createdAt: post.created_at, audience: "Event", locationName: post.location_name, locationAddress: post.location_address,
      image: hydrated[0]?.url || null, mediaType: hydrated[0]?.mediaType || null,
      caption: post.caption || "", likes: (reactions.data || []).filter((item) => item.post_id === post.id).length,
      comments: (comments.data || []).filter((item) => item.post_id === post.id).length,
      liked: (reactions.data || []).some((item) => item.post_id === post.id && item.user_id === userId),
      saved: (saves.data || []).some((item) => item.post_id === post.id && item.user_id === userId),
      allowDownloads: post.allow_downloads,
      carousel: hydrated.length > 1 ? `1/${hydrated.length}` : null, media: hydrated,
    };
  });
}