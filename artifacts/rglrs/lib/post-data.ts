"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AudienceType = "private" | "friends" | "circles" | "events" | "people" | "except";

export type FeedPostData = {
  id: string;
  authorId: string;
  eventId: string | null;
  sharedFromPostId?: string | null;
  author: {
    name: string;
    username: string;
    avatar: string;
  };
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

export type PostMediaInput = {
  uploadId: string;
  mediaType: "image" | "video";
  width?: number;
  height?: number;
  durationMs?: number;
  sortOrder: number;
};

export type CommentData = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    name: string;
    avatar: string;
  };
};

export type SavedCollection = {
  id: string;
  name: string;
  createdAt: string;
  postCount: number;
};

type PostRow = {
  id: string;
  author_id: string;
  event_id: string | null;
  shared_from_post_id: string | null;
  caption: string | null;
  audience_kind: string;
  location_name: string | null;
  location_address: string | null;
  allow_downloads: boolean;
  created_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
  username: string;
  avatar_key: string | null;
};

type MediaRow = {
  id: string;
  post_id: string;
  media_type: "image" | "video";
  sort_order: number;
};

const audienceLabels: Record<AudienceType, string> = {
  private: "Only me",
  friends: "Friends",
  circles: "Circles",
  events: "Events",
  people: "Specific People",
  except: "Everyone Except",
};

function avatarUrl(profile: ProfileRow | undefined, seed: string) {
  if (profile?.avatar_key?.startsWith("http") || profile?.avatar_key?.startsWith("/private-media/")) return profile.avatar_key;
  return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(profile?.display_name || seed)}`;
}

export function formatRelativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function encodeCursor(createdAt: string, id: string) {
  return `${createdAt}|${id}`;
}

function decodeCursor(cursor: string) {
  const separator = cursor.lastIndexOf("|");
  if (separator < 0) return null;
  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!createdAt || !id || Number.isNaN(new Date(createdAt).getTime())) return null;
  return { createdAt, id };
}

function audienceText(audienceKind: string) {
  switch (audienceKind) {
    case "friends":
      return audienceLabels.friends;
    case "circles":
      return audienceLabels.circles;
    case "events":
      return audienceLabels.events;
    case "people":
      return audienceLabels.people;
    case "except":
      return audienceLabels.except;
    default:
      return "Private";
  }
}

async function rowsForPostIds(postIds: string[], authorIds: string[], userId: string) {
  if (postIds.length === 0) {
    return {
      profiles: [] as ProfileRow[],
      media: [] as MediaRow[],
      reactions: [] as { post_id: string; user_id: string }[],
      saves: [] as { post_id: string; user_id: string }[],
      comments: [] as { post_id: string }[],
    };
  }

  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const [profilesResult, mediaResult, reactionsResult, savesResult, commentsResult] =
    await Promise.all([
      supabase.from("profiles").select("id,display_name,username,avatar_key").in("id", [...new Set(authorIds)]),
      supabase.from("post_media").select("id,post_id,media_type,sort_order").in("post_id", postIds).order("sort_order"),
      supabase.from("reactions").select("post_id,user_id").in("post_id", postIds),
      supabase.from("saves").select("post_id,user_id").eq("user_id", userId).in("post_id", postIds),
      supabase.from("comments").select("post_id").in("post_id", postIds),
    ]);

  const failed = [profilesResult, mediaResult, reactionsResult, savesResult, commentsResult]
    .find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  return {
    profiles: (profilesResult.data || []) as ProfileRow[],
    media: (mediaResult.data || []) as MediaRow[],
    reactions: (reactionsResult.data || []) as { post_id: string; user_id: string }[],
    saves: (savesResult.data || []) as { post_id: string; user_id: string }[],
    comments: (commentsResult.data || []) as { post_id: string }[],
  };
}

function hydratePosts(rows: PostRow[], related: Awaited<ReturnType<typeof rowsForPostIds>>, userId: string) {
  return rows.map((row) => {
    const profile = related.profiles.find((item) => item.id === row.author_id);
    const media = related.media.filter((item) => item.post_id === row.id);
    const likes = related.reactions.filter((item) => item.post_id === row.id).length;
    const comments = related.comments.filter((item) => item.post_id === row.id).length;
    const firstMedia = media[0];

    return {
      id: row.id,
      authorId: row.author_id,
      eventId: row.event_id,
      sharedFromPostId: row.shared_from_post_id,
      author: {
        name: profile?.display_name || "RGLR",
        username: profile?.username || "",
        avatar: avatarUrl(profile, row.author_id),
      },
      time: formatRelativeTime(row.created_at),
      createdAt: row.created_at,
      audience: audienceText(row.audience_kind),
      locationName: row.location_name,
      locationAddress: row.location_address,
      image: firstMedia ? `/private-media/${firstMedia.id}` : null,
      mediaType: firstMedia?.media_type || null,
      caption: row.caption || "",
      likes,
      comments,
      liked: related.reactions.some((item) => item.post_id === row.id && item.user_id === userId),
      saved: related.saves.some((item) => item.post_id === row.id && item.user_id === userId),
      allowDownloads: row.allow_downloads,
      carousel: media.length > 1 ? `1/${media.length}` : null,
      media: media.map((item) => ({
        id: item.id,
        url: `/private-media/${item.id}`,
        mediaType: item.media_type,
      })),
    } satisfies FeedPostData;
  });
}

export async function getCurrentUserId() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id || null;
}

export function isSupabaseAvailable() {
  return Boolean(getSupabaseBrowserClient());
}

export async function fetchFeedPage(cursor?: string, limit = 10, postId?: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to view your private feed.");

  if (postId) {
    const { data, error } = await supabase
      .from("posts")
      .select("id,author_id,event_id,shared_from_post_id,caption,audience_kind,location_name,location_address,allow_downloads,created_at")
      .eq("id", postId)
      .limit(1);
    if (error) throw new Error(error.message);
    const pageRows = (data || []) as PostRow[];
    const related = await rowsForPostIds(
      pageRows.map((row) => row.id),
      pageRows.map((row) => row.author_id),
      userId,
    );
    return {
      posts: hydratePosts(pageRows, related, userId),
      nextCursor: null,
      hasMore: false,
    };
  }

  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw new Error("Invalid feed cursor");
  const { data, error } = await supabase.rpc("list_feed_page_secure", {
    p_before_created_at: decoded?.createdAt || null,
    p_before_id: decoded?.id || null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  const rows = (data || []) as PostRow[];
  const pageRows = rows.slice(0, limit);
  const related = await rowsForPostIds(
    pageRows.map((row) => row.id),
    pageRows.map((row) => row.author_id),
    userId,
  );

  return {
    posts: hydratePosts(pageRows, related, userId),
    nextCursor: rows.length > limit ? encodeCursor(pageRows[pageRows.length - 1].created_at, pageRows[pageRows.length - 1].id) : null,
    hasMore: rows.length > limit,
  };
}

export async function fetchSavedPosts() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to view your saved posts.");

  const { data: saveData, error: saveError } = await supabase
    .from("saves")
    .select("post_id,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("post_id", { ascending: false });
  if (saveError) throw new Error(saveError.message);

  const savedRows = (saveData || []) as { post_id: string; created_at: string }[];
  if (!savedRows.length) return [];

  const postIds = savedRows.map((save) => save.post_id);
  const { data: postData, error: postError } = await supabase
    .from("posts")
    .select("id,author_id,event_id,shared_from_post_id,caption,audience_kind,location_name,location_address,allow_downloads,created_at")
    .in("id", postIds);
  if (postError) throw new Error(postError.message);

  const postsById = new Map(((postData || []) as PostRow[]).map((post) => [post.id, post]));
  // The posts query is intentionally separate: its RLS policy removes saved
  // posts whose audience the user can no longer access.
  const visiblePosts = postIds
    .map((postId) => postsById.get(postId))
    .filter((post): post is PostRow => Boolean(post));
  const related = await rowsForPostIds(
    visiblePosts.map((post) => post.id),
    visiblePosts.map((post) => post.author_id),
    userId,
  );

  return hydratePosts(visiblePosts, related, userId);
}

export async function fetchSavedCollections(): Promise<SavedCollection[]> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to view your saved collections.");

  const { data, error } = await supabase
    .from("saved_collections")
    .select("id,name,created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data || []) as { id: string; name: string; created_at: string }[];
  if (!rows.length) return [];

  const { data: membershipData, error: membershipError } = await supabase
    .from("saved_collection_posts")
    .select("collection_id")
    .in("collection_id", rows.map((row) => row.id));
  if (membershipError) throw new Error(membershipError.message);

  const counts = new Map<string, number>();
  for (const membership of (membershipData || []) as { collection_id: string }[]) {
    counts.set(membership.collection_id, (counts.get(membership.collection_id) || 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    postCount: counts.get(row.id) || 0,
  }));
}

export async function fetchSavedCollectionMemberships(postIds: string[]) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to view your saved collections.");

  const memberships: Record<string, string[]> = {};
  if (!postIds.length) return memberships;

  const { data, error } = await supabase
    .from("saved_collection_posts")
    .select("collection_id,post_id")
    .in("post_id", postIds);
  if (error) throw new Error(error.message);

  for (const row of (data || []) as { collection_id: string; post_id: string }[]) {
    memberships[row.post_id] = [...(memberships[row.post_id] || []), row.collection_id];
  }
  return memberships;
}

export async function fetchSavedCollectionPosts(collectionId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to view your saved collection.");

  const { data: membershipData, error: membershipError } = await supabase
    .from("saved_collection_posts")
    .select("post_id,added_at")
    .eq("collection_id", collectionId)
    .order("added_at", { ascending: false })
    .order("post_id", { ascending: false });
  if (membershipError) throw new Error(membershipError.message);

  const memberships = (membershipData || []) as { post_id: string; added_at: string }[];
  if (!memberships.length) return [];

  const { data: postData, error: postError } = await supabase
    .from("posts")
    .select("id,author_id,event_id,shared_from_post_id,caption,audience_kind,location_name,location_address,allow_downloads,created_at")
    .in("id", memberships.map((membership) => membership.post_id));
  if (postError) throw new Error(postError.message);

  // Keep membership order while allowing posts RLS to hide posts the owner
  // can no longer access.
  const postsById = new Map(((postData || []) as PostRow[]).map((post) => [post.id, post]));
  const visiblePosts = memberships
    .map((membership) => postsById.get(membership.post_id))
    .filter((post): post is PostRow => Boolean(post));
  const related = await rowsForPostIds(
    visiblePosts.map((post) => post.id),
    visiblePosts.map((post) => post.author_id),
    userId,
  );

  return hydratePosts(visiblePosts, related, userId);
}

function collectionName(name: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Name your collection first.");
  if (cleanName.length > 80) throw new Error("Collection names must be 80 characters or fewer.");
  return cleanName;
}

export async function createSavedCollection(name: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to create a collection.");

  const { data, error } = await supabase
    .from("saved_collections")
    .insert({ owner_id: userId, name: collectionName(name) })
    .select("id,name,created_at")
    .single();
  if (error || !data) throw new Error(error?.message || "Could not create collection.");

  const row = data as { id: string; name: string; created_at: string };
  return { id: row.id, name: row.name, createdAt: row.created_at, postCount: 0 } satisfies SavedCollection;
}

export async function renameSavedCollection(collectionId: string, name: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to rename a collection.");

  const { data, error } = await supabase
    .from("saved_collections")
    .update({ name: collectionName(name) })
    .eq("id", collectionId)
    .eq("owner_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This collection no longer exists or is unavailable.");
}

export async function deleteSavedCollection(collectionId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to delete a collection.");

  const { data, error } = await supabase
    .from("saved_collections")
    .delete()
    .eq("id", collectionId)
    .eq("owner_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This collection no longer exists or is unavailable.");
}

export async function addPostToSavedCollection(collectionId: string, postId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to manage your saved collections.");

  const { error } = await supabase.from("saved_collection_posts").insert({
    collection_id: collectionId,
    post_id: postId,
  });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function removePostFromSavedCollection(collectionId: string, postId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to manage your saved collections.");

  const { error } = await supabase
    .from("saved_collection_posts")
    .delete()
    .eq("collection_id", collectionId)
    .eq("post_id", postId);
  if (error) throw new Error(error.message);
}

export async function fetchComments(postId: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");

  const { data, error } = await supabase
    .from("comments")
    .select("id,author_id,body,created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = (data || []) as { id: string; author_id: string; body: string; created_at: string }[];
  const profileIds = [...new Set(rows.map((row) => row.author_id))];
  const { data: profiles, error: profileError } = profileIds.length
    ? await supabase.from("profiles").select("id,display_name,username,avatar_key").in("id", profileIds)
    : { data: [], error: null };
  if (profileError) throw new Error(profileError.message);

  return rows.map((row) => {
    const profile = (profiles || []).find((item) => item.id === row.author_id) as ProfileRow | undefined;
    return {
      id: row.id,
      body: row.body,
      createdAt: row.created_at,
      author: {
        name: profile?.display_name || "RGLR",
        avatar: avatarUrl(profile, row.author_id),
      },
    } satisfies CommentData;
  });
}

export async function addComment(postId: string, body: string) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to comment.");

  const cleanBody = body.trim();
  if (!cleanBody) throw new Error("Write a comment first.");
  const { error } = await supabase.rpc("add_comment_secure", {
    p_post: postId,
    p_body: cleanBody,
  });
  if (error) {
    throw new Error(error.message.includes("RATE_LIMITED") ? "You’re commenting too quickly. Try again later." : error.message);
  }
}

export async function createPost(input: {
  caption: string;
  audience: AudienceType | null;
  subjectIds?: string[];
  media?: PostMediaInput[];
  locationName?: string;
  locationAddress?: string;
  allowDownloads?: boolean | null;
}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase is not configured");
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in to share a post.");

  const subjectIds = [...new Set(input.subjectIds || [])];
  switch (input.audience) {
    case "friends":
      break;
    case "circles":
      if (!subjectIds.length) throw new Error("Choose at least one circle.");
      break;
    case "events":
      if (!subjectIds.length) throw new Error("Choose an event before sharing.");
      break;
    case "people":
      if (!subjectIds.length) throw new Error("Choose at least one person.");
      break;
    case "except":
      if (!subjectIds.length) throw new Error("Choose at least one person to hide this from.");
      break;
  }

  if (input.caption.trim().length > 220) throw new Error("Captions can be up to 220 characters.");
  if ((input.locationName?.trim().length || 0) > 160) throw new Error("Locations can be up to 160 characters.");
  if ((input.locationAddress?.trim().length || 0) > 240) throw new Error("Location addresses can be up to 240 characters.");
  if ((input.media?.length || 0) > 8) throw new Error("Choose up to 8 photos or videos.");
  const { data, error } = await supabase.rpc("create_post_secure", {
    p_caption: input.caption.trim(),
    p_audience: input.audience,
    p_subject_ids: subjectIds,
    p_media: (input.media || []).map((media) => ({
      upload_id: media.uploadId,
      sort_order: media.sortOrder,
    })),
    p_location_name: input.locationName?.trim() || null,
    p_location_address: input.locationAddress?.trim() || null,
    p_allow_downloads: input.allowDownloads ?? null,
  });
  if (error || typeof data !== "string") {
    const message = error?.message || "Could not create post.";
    throw new Error(message.includes("RATE_LIMITED") ? "You’re sharing too quickly. Try again later." : message);
  }
  return data;
}