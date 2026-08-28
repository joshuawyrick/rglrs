"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { requireRpc } from "@/lib/social-data";

type UnreadValue = { messages: number; notifications: number; refresh: () => Promise<void> };
const UnreadContext = createContext<UnreadValue>({ messages: 0, notifications: 0, refresh: async () => undefined });

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState(0);
  const [notifications, setNotifications] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const data = await requireRpc("unread_counts_secure");
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      setMessages(typeof row?.message_count === "number" ? row.message_count : typeof row?.unread_messages === "number" ? row.unread_messages : typeof row?.messages === "number" ? row.messages : 0);
      setNotifications(typeof row?.notification_count === "number" ? row.notification_count : typeof row?.unread_notifications === "number" ? row.unread_notifications : typeof row?.notifications === "number" ? row.notifications : 0);
    } catch {
      // Navigation remains usable when counts cannot be refreshed.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => document.visibilityState === "visible" && void refresh(), 15000);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo(() => ({ messages, notifications, refresh }), [messages, notifications, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);

export function NavBadge({ count }: { count: number }) {
  return count > 0 ? <span className="nav-unread" aria-label={`${count} unread`}>{count > 99 ? "99+" : count}</span> : null;
}