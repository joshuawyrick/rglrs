"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Info, Mic, RotateCcw, Send, Trash2, Video } from "lucide-react";
import { MobileHeader } from "@/components/mobile-header";
import { useUnread } from "@/components/unread-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { uploadMessageFile, type ReadyMessageUpload } from "@/lib/message-upload";
import { ChatMessage, parseMessage, requireRpc, rows } from "@/lib/social-data";

type Upload = { key: string; file: File; preview: string; status: "uploading" | "ready" | "failed"; error?: string; result?: ReadyMessageUpload };

export function ChatClient({ conversationId }: { conversationId: string }) {
  const unread = useUnread();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("Conversation");
  const [draft, setDraft] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const idempotency = useRef(crypto.randomUUID());
  const draftKey = `rglrs:message-draft:${conversationId}`;
  const uploadsRef = useRef<Upload[]>([]);

  useEffect(() => { uploadsRef.current = uploads; }, [uploads]);
  useEffect(() => {
    const saved = localStorage.getItem(draftKey);
    if (saved) setDraft(saved.slice(0, 4000));
    return () => uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.preview));
  }, [draftKey]);
  useEffect(() => {
    if (draft) localStorage.setItem(draftKey, draft);
    else localStorage.removeItem(draftKey);
  }, [draft, draftKey]);
  useEffect(() => { void getSupabaseBrowserClient()?.auth.getUser().then(({ data }) => setUserId(data.user?.id || "")); }, []);

  const load = useCallback(async (older = false) => {
    if (older) setLoadingOlder(true);
    try {
      const oldest = older && messages.length ? messages[0] : null;
      const data = await requireRpc("list_messages_secure", { p_conversation: conversationId, p_before_created_at: oldest?.createdAt || null, p_before_id: oldest?.id || null, p_limit: 40 });
      const parsed = rows(data, "messages").map(parseMessage).filter((item) => item.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setMessages((current) => {
        const combined = current.length ? [...current, ...parsed] : parsed;
        return combined
          .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      if (older) setHasOlder(parsed.length === 40);
      setError(null);
      if (!older) {
        const through = parsed.at(-1);
        if (through) await requireRpc("mark_conversation_read_secure", {
          p_conversation: conversationId,
          p_through: through.createdAt,
          p_through_id: through.id,
        });
        await unread.refresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load messages.");
    } finally {
      setLoading(false);
      setLoadingOlder(false);
    }
  }, [conversationId, messages, unread]);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    void loadRef.current(false);
    void requireRpc("list_conversations_secure").then((data) => {
      const conversation = rows(data).find((row) => row.conversation_id === conversationId || row.id === conversationId);
      const name = conversation?.presentation_name || conversation?.title;
      if (typeof name === "string" && name) setTitle(name);
    }).catch(() => undefined);
    const interval = window.setInterval(() => document.visibilityState === "visible" && void loadRef.current(false), 4000);
    const refresh = () => void loadRef.current(false);
    const visible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [conversationId]);

  const runUpload = async (key: string, file: File) => {
    setUploads((current) => current.map((item) => item.key === key ? { ...item, status: "uploading", error: undefined } : item));
    try {
      const result = await uploadMessageFile(file);
      setUploads((current) => current.map((item) => item.key === key ? { ...item, status: "ready", result } : item));
    } catch (cause) {
      setUploads((current) => current.map((item) => item.key === key ? { ...item, status: "failed", error: cause instanceof Error ? cause.message : "Upload failed." } : item));
    }
  };
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const room = Math.max(0, 8 - uploads.length);
    const selectedCount = event.target.files?.length || 0;
    const files = Array.from(event.target.files || []).slice(0, room);
    const additions = files.map((file) => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file), status: "uploading" as const }));
    setUploads((current) => [...current, ...additions]);
    additions.forEach((item) => void runUpload(item.key, item.file));
    event.target.value = "";
    if (files.length < selectedCount) setSendError("A message can include up to 8 attachments.");
  };
  const removeUpload = (key: string) => setUploads((current) => current.filter((item) => {
    if (item.key === key) {
      URL.revokeObjectURL(item.preview);
      if (item.result) void fetch(`/private-media/uploads/${item.result.uploadId}`, { method: "DELETE" }).catch(() => undefined);
      return false;
    }
    return true;
  }));

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body && !uploads.length) return;
    if (uploads.some((item) => item.status !== "ready")) return setSendError("Wait for attachments to finish or retry failed uploads.");
    setSending(true);
    setSendError(null);
    try {
      await requireRpc("send_message_secure", {
        p_conversation: conversationId,
        p_body: body || null,
        p_upload_ids: uploads.map((item) => item.result?.uploadId),
        p_client_message_id: idempotency.current,
      });
      uploads.forEach((item) => URL.revokeObjectURL(item.preview));
      setDraft("");
      setUploads([]);
      idempotency.current = crypto.randomUUID();
      await loadRef.current(false);
      await unread.refresh();
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Message could not be sent. Retry safely.");
    } finally {
      setSending(false);
    }
  };

  return <div className="chat-screen">
    <MobileHeader title={title} backHref="/messages" right={<div className="row gap6"><button className="screen-icon-btn" disabled aria-label="Video calling unavailable" title="Video calling unavailable"><Video size={17}/></button><button className="screen-icon-btn" disabled aria-label="Conversation info unavailable" title="Conversation info unavailable"><Info size={17}/></button></div>}/>
    <div className="chat-body">
      {hasOlder && messages.length ? <button className="text-btn" disabled={loadingOlder} onClick={() => void load(true)}>{loadingOlder ? "Loading…" : "Load older messages"}</button> : null}
      {loading ? <div className="empty-state" role="status"><span>Loading messages…</span></div> : null}
      {error ? <div className="empty-state"><strong>Could not load chat</strong><span>{error}</span><button className="secondary-btn" onClick={() => void load(false)}>Retry</button></div> : null}
      {!loading && !error && !messages.length ? <div className="empty-state"><strong>No messages yet</strong><span>Start the conversation below.</span></div> : null}
      {messages.map((message) => <div className={`bubble-row ${message.senderId === userId ? "mine" : ""}`} key={message.id}>{message.senderId !== userId ? message.senderAvatar?.startsWith("http") || message.senderAvatar?.startsWith("/private-media/") ? <img className="profile-avatar-small chat-avatar" src={message.senderAvatar} alt="" /> : <div className="profile-avatar-fallback chat-avatar">{message.senderName.slice(0,1).toUpperCase()}</div> : null}<div><div className={`bubble ${message.senderId === userId ? "mine" : ""}`}>{message.body ? <div>{message.body}</div> : null}{message.media.map((media) => media.type === "video" ? <video className="chat-image" key={media.id} src={`/private-media/${media.id}`} controls preload="metadata"/> : <img className="chat-image" key={media.id} src={`/private-media/${media.id}`} alt="Message attachment"/>)}</div><div className="chat-time">{new Date(message.createdAt).toLocaleString([], { dateStyle:"short", timeStyle:"short" })}</div></div></div>)}
    </div>
    {uploads.length ? <div className="chat-uploads">{uploads.map((upload) => <div className="chat-upload" key={upload.key}>{upload.file.type.startsWith("video/") ? <video src={upload.preview}/> : <img src={upload.preview} alt="Selected attachment"/>}<button type="button" onClick={() => removeUpload(upload.key)} aria-label="Remove attachment"><Trash2 size={12}/></button><span>{upload.status === "uploading" ? "Uploading…" : upload.status === "ready" ? "Ready" : upload.error}</span>{upload.status === "failed" ? <button type="button" className="upload-retry" onClick={() => void runUpload(upload.key, upload.file)}><RotateCcw size={11}/> Retry</button> : null}</div>)}</div> : null}
    {sendError ? <p className="form-message error-message chat-send-error" role="alert">{sendError}</p> : null}
    <form className="chat-compose" onSubmit={send}><label className="screen-icon-btn" aria-label="Add photo or video" title={uploads.length >= 8 ? "Maximum 8 attachments" : "Add photo or video"}><ImagePlus size={17}/><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple disabled={uploads.length >= 8 || sending} onChange={choose}/></label><input className="input" value={draft} maxLength={4000} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${title}…`}/><button type="button" className="screen-icon-btn" disabled aria-label="Voice messages unavailable" title="Voice messages unavailable"><Mic size={16}/></button><button className="screen-icon-btn" disabled={sending || (!draft.trim() && !uploads.length)} aria-label="Send message">{sending ? <span className="tiny-spinner"/> : <Send size={16}/>}</button></form>
  </div>;
}