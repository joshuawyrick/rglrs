"use client";

import Link from "next/link";
import { Edit3, Search, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { useUnread } from "@/components/unread-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Conversation, parseConversation, relativeTime, requireRpc, rows } from "@/lib/social-data";

type Friend = { id: string; name: string };

export default function MessagesPage() {
  const router = useRouter();
  const unread = useUnread();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendError, setFriendError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const composerTriggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await requireRpc("list_conversations_secure");
      setConversations(rows(data, "conversations").map(parseConversation).filter((item) => item.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const closeComposer = useCallback(() => {
    setComposing(false);
    setSelected([]);
    setTitle("");
    setFriends([]);
    setFriendError(null);
    setCreating(false);
    window.setTimeout(() => composerTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!composing) return;
    const dialog = dialogRef.current;
    const focusFrame = window.requestAnimationFrame(() => (titleInputRef.current || dialog)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeComposer();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeComposer, composing]);

  const openComposer = async () => {
    setSelected([]);
    setTitle("");
    setFriends([]);
    setComposing(true);
    setFriendError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Connect Supabase to start a conversation.");
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error(userError?.message || "Sign in to start a conversation.");
      const [friendships, blocks] = await Promise.all([
        supabase.from("friendships").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`).limit(200),
        supabase.from("blocks").select("blocker_id,blocked_id").or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`).limit(200),
      ]);
      if (friendships.error || blocks.error) throw new Error(friendships.error?.message || blocks.error?.message || "Could not load friends.");
      const blocked = new Set((blocks.data || []).map((item) => item.blocker_id === user.id ? item.blocked_id : item.blocker_id));
      const ids = (friendships.data || []).map((item) => item.requester_id === user.id ? item.addressee_id : item.requester_id).filter((id) => !blocked.has(id));
      if (!ids.length) return setFriends([]);
      const profiles = await supabase.from("profiles").select("id,display_name,avatar_key").in("id", ids).order("display_name").limit(200);
      if (profiles.error) throw new Error(profiles.error.message);
      setFriends((profiles.data || []).map((profile) => ({ id: profile.id, name: profile.display_name })));
    } catch (cause) {
      setFriendError(cause instanceof Error ? cause.message : "Could not load friends.");
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.length) return;
    setCreating(true);
    setFriendError(null);
    try {
      if (selected.length > 1 && !title.trim()) throw new Error("Add a title for a group conversation.");
      const data = await requireRpc("create_conversation_secure", { p_participant_ids: selected, p_title: title.trim() || null });
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | string | null;
      const id = typeof row === "string" ? row : typeof row?.conversation_id === "string" ? row.conversation_id : typeof row?.id === "string" ? row.id : "";
      if (!id) throw new Error("Conversation was created, but no conversation ID was returned.");
      await unread.refresh();
      router.push(`/messages/${id}`);
    } catch (cause) {
      setFriendError(cause instanceof Error ? cause.message : "Could not create conversation.");
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? conversations.filter((item) => `${item.title} ${item.preview}`.toLocaleLowerCase().includes(needle)) : conversations;
  }, [conversations, query]);

  return <PageShell>
    <div className="row space" style={{minHeight:52}}><h1 style={{margin:0,fontSize:18}}>Messages</h1><button ref={composerTriggerRef} className="screen-icon-btn" onClick={() => void openComposer()} aria-label="Start conversation"><Edit3 size={17}/></button></div>
    <label className="search-box"><Search size={15} color="var(--muted)"/><span className="sr-only">Filter conversations</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter conversations…"/></label>
    {loading ? <div className="empty-state" role="status"><span>Loading conversations…</span></div> : null}
    {error ? <div className="empty-state"><strong>Could not load messages</strong><span>{error}</span><button className="secondary-btn" onClick={() => { setLoading(true); void load(); }}>Retry</button></div> : null}
    {!loading && !error && !filtered.length ? <div className="empty-state"><strong>{query ? "No matching conversations" : "No conversations yet"}</strong><span>{query ? "Try a different filter." : "Start a private conversation with an accepted friend."}</span></div> : null}
    <div className="message-list" style={{marginTop:7}}>{filtered.map((conversation) => <Link href={`/messages/${conversation.id}`} className="conversation-row" key={conversation.id}>{conversation.avatarUrl?.startsWith("http") || conversation.avatarUrl?.startsWith("/private-media/") ? <img className="profile-avatar-small message-avatar" src={conversation.avatarUrl} alt="" /> : <div className="profile-avatar-fallback message-avatar">{conversation.title.slice(0,1).toUpperCase()}</div>}<div className="conversation-main"><div className="conversation-name">{conversation.title}</div><div className="conversation-preview">{conversation.preview || "No messages yet"}</div></div><div className="stack" style={{alignItems:"flex-end",gap:6}}><span className="conversation-time">{relativeTime(conversation.updatedAt)}</span>{conversation.unread ? <span className="unread-badge">{conversation.unread}</span> : null}</div></Link>)}</div>
    {composing ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}><form ref={dialogRef} tabIndex={-1} className="composer-dialog card" onSubmit={create} role="dialog" aria-modal="true" aria-labelledby="new-chat-title"><div className="row space"><h2 id="new-chat-title">New conversation</h2><button type="button" className="screen-icon-btn" onClick={closeComposer} aria-label="Close"><X size={17}/></button></div><label className="form-label">Group title {selected.length > 1 ? "(required)" : "(optional)"}<input ref={titleInputRef} className="input" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Weekend crew"/></label><div className="form-label">Accepted friends</div><div className="friend-picker">{friends.map((friend) => <label className="friend-choice" key={friend.id}><input type="checkbox" checked={selected.includes(friend.id)} onChange={() => setSelected((current) => current.includes(friend.id) ? current.filter((id) => id !== friend.id) : [...current, friend.id])}/><span>{friend.name}</span></label>)}</div>{!friendError && !friends.length ? <p className="form-hint">No eligible friends are available. Blocked members are never shown.</p> : null}{friendError ? <p className="form-message error-message" role="alert">{friendError}</p> : null}<button className="primary-btn" disabled={creating || !selected.length}>{creating ? "Starting…" : "Start conversation"}</button></form></div> : null}
  </PageShell>;
}