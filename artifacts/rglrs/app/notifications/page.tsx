"use client";

import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { useUnread } from "@/components/unread-provider";
import { AppNotification, parseNotification, relativeTime, requireRpc, rows } from "@/lib/social-data";

function dateGroup(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

export default function Notifications() {
  const unread = useUnread();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await requireRpc("list_notifications_secure", { p_before_created_at: null, p_before_id: null, p_limit: 100 });
      setItems(rows(data, "notifications").map(parseNotification).filter((item) => item.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    void load();
    const interval = window.setInterval(() => document.visibilityState === "visible" && void loadRef.current(), 15000);
    const refresh = () => void loadRef.current();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [load]);

  const mark = async (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.readAt) return;
    setBusy(id);
    try {
      await requireRpc("mark_notification_read_secure", { p_notification: id });
      setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, readAt: new Date().toISOString() } : candidate));
      await unread.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark notification read.");
    } finally { setBusy(null); }
  };
  const markAll = async () => {
    setBusy("all");
    try {
      await requireRpc("mark_all_notifications_read_secure");
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      await unread.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not mark notifications read.");
    } finally { setBusy(null); }
  };
  const grouped = useMemo(() => items.reduce<Record<string, AppNotification[]>>((all, item) => {
    (all[dateGroup(item.createdAt)] ||= []).push(item);
    return all;
  }, {}), [items]);

  return <PageShell>
    <MobileHeader title="Notifications" backHref="/" right={<button className="screen-icon-btn" onClick={() => void markAll()} disabled={busy === "all" || !items.some((item) => !item.readAt)} aria-label="Mark all read" title="Mark all read"><CheckCheck size={17}/></button>}/>
    {loading ? <div className="empty-state" role="status"><span>Loading notifications…</span></div> : null}
    {error ? <div className="empty-state"><strong>Activity could not be refreshed</strong><span>{error}</span><button className="secondary-btn" onClick={() => void load()}>Retry</button></div> : null}
    {!loading && !error && !items.length ? <div className="empty-state"><strong>No notifications yet</strong><span>New private activity will appear here.</span></div> : null}
    {Object.entries(grouped).map(([group, notifications]) => <section key={group}><div className="list-section-label">{group}</div>{notifications.map((notification) => {
      const content = <>{notification.actorAvatar?.startsWith("http") || notification.actorAvatar?.startsWith("/private-media/") ? <img className="profile-avatar-small notification-avatar" src={notification.actorAvatar} alt="" /> : <div className="profile-avatar-fallback notification-avatar">{notification.actorName.slice(0,1).toUpperCase()}</div>}<div className="notification-text"><strong>{notification.actorName}</strong> {notification.text}<span className="notification-time">{relativeTime(notification.createdAt)}</span></div><button className="notification-read" disabled={!!notification.readAt || busy === notification.id} onClick={(event) => { event.preventDefault(); void mark(notification.id); }} aria-label={notification.readAt ? "Read" : "Mark read"}>{notification.readAt ? "Read" : "Mark read"}</button></>;
      return notification.href ? <Link href={notification.href} onClick={() => void mark(notification.id)} className={`notification-row ${notification.readAt ? "" : "unread"}`} key={notification.id}>{content}</Link> : <div className={`notification-row ${notification.readAt ? "" : "unread"}`} key={notification.id}>{content}</div>;
    })}</section>)}
  </PageShell>;
}