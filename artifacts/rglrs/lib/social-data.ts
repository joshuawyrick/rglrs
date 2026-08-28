"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type JsonRow = Record<string, unknown>;
export type Conversation = {
  id: string;
  title: string;
  avatarUrl: string | null;
  preview: string;
  updatedAt: string | null;
  unread: number;
  memberCount: number;
};
export type ChatMessage = {
  id: string;
  clientId: string | null;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  body: string;
  createdAt: string;
  media: { id: string; type: "image" | "video" }[];
};
export type AppNotification = {
  id: string;
  actorName: string;
  actorAvatar: string | null;
  text: string;
  createdAt: string;
  readAt: string | null;
  href: string | null;
};

export function rows(value: unknown, key?: string): JsonRow[] {
  const source = Array.isArray(value) ? value : key && value && typeof value === "object" ? (value as JsonRow)[key] : value;
  return Array.isArray(source) ? source.filter((item): item is JsonRow => !!item && typeof item === "object") : [];
}

const text = (row: JsonRow, ...keys: string[]) => {
  for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
  return "";
};
const count = (row: JsonRow, ...keys: string[]) => {
  for (const key of keys) if (typeof row[key] === "number") return row[key] as number;
  return 0;
};

export function parseConversation(row: JsonRow): Conversation {
  return {
    id: text(row, "id", "conversation_id"),
    title: text(row, "presentation_name", "title", "name", "display_name") || "Conversation",
    avatarUrl: text(row, "presentation_avatar_key", "avatar_url", "avatarUrl") || null,
    preview: text(row, "last_message", "last_message_body", "preview"),
    updatedAt: text(row, "last_message_created_at", "updated_at", "last_message_at", "created_at") || null,
    unread: count(row, "unread_count", "unread"),
    memberCount: count(row, "member_count", "members"),
  };
}

export function parseMessage(row: JsonRow): ChatMessage {
  const mediaRows = rows(row.media || row.message_media);
  return {
    id: text(row, "id", "message_id"),
    clientId: text(row, "client_message_id", "client_id", "idempotency_key") || null,
    senderId: text(row, "sender_id", "author_id"),
    senderName: text(row, "sender_display_name", "sender_name", "display_name") || "Member",
    senderAvatar: text(row, "sender_avatar_key", "sender_avatar_url", "avatar_url") || null,
    body: text(row, "body", "text", "content"),
    createdAt: text(row, "created_at", "sent_at"),
    media: mediaRows.map((item): { id: string; type: "image" | "video" } => ({
      id: text(item, "id", "message_media_id"),
      type: text(item, "media_type", "type") === "video" ? "video" : "image",
    })).filter((item) => item.id),
  };
}

function safeHref(row: JsonRow): string | null {
  const candidate = text(row, "href", "deep_link", "target_url");
  if (candidate.startsWith("/") && !candidate.startsWith("//") &&
      ["/messages/", "/people/", "/events/", "/post/"].some((prefix) => candidate.startsWith(prefix))) return candidate;
  const type = text(row, "target_type", "entity_type");
  const id = text(row, "target_id", "entity_id", "conversation_id");
  if (type === "friendship") {
    const actor = text(row, "actor_id");
    return /^[0-9a-f-]{20,}$/i.test(actor) ? `/people/${actor}` : null;
  }
  const prefix = type === "conversation" ? "/messages/" : type === "profile" || type === "person" ? "/people/" : type === "event" ? "/events/" : type === "post" ? "/post/" : "";
  return prefix && /^[0-9a-f-]{20,}$/i.test(id) ? `${prefix}${id}` : null;
}

export function parseNotification(row: JsonRow): AppNotification {
  const kind = text(row, "type");
  const descriptions: Record<string, string> = {
    friend_request: "sent you a friend request.",
    friend_accepted: "accepted your friend request.",
    event_invitation: "requested access to an event.",
    event_approval_accepted: "approved your event access.",
    event_approval_declined: "declined your event access.",
    comment: "commented on your post.",
    reaction: "reacted to your post.",
    message: "sent you a message.",
  };
  return {
    id: text(row, "id", "notification_id"),
    actorName: text(row, "actor_display_name", "actor_name", "display_name") || "RGLRS",
    actorAvatar: text(row, "actor_avatar_key", "actor_avatar_url", "avatar_url") || null,
    text: text(row, "text", "message", "body", "title") || descriptions[kind] || "sent new activity.",
    createdAt: text(row, "created_at"),
    readAt: text(row, "read_at") || null,
    href: safeHref(row),
  };
}

export async function requireRpc(name: string, args: Record<string, unknown> = {}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("This feature is unavailable until Supabase is connected.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message || "The request could not be completed.");
  return data as unknown;
}

export function relativeTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}