"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, UserMinus, UserRound, UsersRound } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { normalizeAudienceSubjectIds, toggleAudienceSubjectId } from "@/lib/audience-selection";
import { getCurrentUserId, isSupabaseAvailable, type AudienceType } from "@/lib/post-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const options: { id: AudienceType; title: string; sub: string; Icon: typeof UsersRound }[] = [
  { id: "private", title: "Only me", sub: "Keep this post private", Icon: UsersRound },
  { id: "friends", title: "Friends", sub: "All your friends", Icon: UsersRound },
  { id: "circles", title: "Circles", sub: "Choose one or more circles", Icon: UsersRound },
  { id: "events", title: "Events", sub: "Share to an event", Icon: CalendarDays },
  { id: "people", title: "Specific People", sub: "Choose people", Icon: UserRound },
  { id: "except", title: "Everyone Except", sub: "Hide from people", Icon: UserMinus },
];

type AudienceItem = { id: string; label: string };

function AudiencePickerForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialAudience = (searchParams.get("audience") as AudienceType | null) || "friends";
  const initialSubjects = useMemo(() => (searchParams.get("subjects") || "").split(",").filter(Boolean), [searchParams]);
  const [selected, setSelected] = useState<AudienceType>(options.some((option) => option.id === initialAudience) ? initialAudience : "friends");
  const [selectedIds, setSelectedIds] = useState<string[]>(() => normalizeAudienceSubjectIds(
    options.some((option) => option.id === initialAudience) ? initialAudience : "friends",
    initialSubjects,
  ));
  const [items, setItems] = useState<AudienceItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    if (selected === "friends" || selected === "private") {
      setItems([]);
      setItemsError(null);
      setLoadingItems(false);
      return () => { active = false; };
    }
    if (!isSupabaseAvailable()) {
      setItems([]);
      setItemsError("Connect Supabase to choose an audience.");
      setLoadingItems(false);
      return () => { active = false; };
    }
    (async () => {
      if (active) {
        setLoadingItems(true);
        setItemsError(null);
      }
      try {
        const userId = await getCurrentUserId();
        const supabase = getSupabaseBrowserClient();
        if (!userId || !supabase) throw new Error("Sign in to choose an audience.");
        let result: { data: unknown[] | null; error: { message: string } | null };
        if (selected === "circles") {
          result = await supabase.from("circles").select("id,name").eq("owner_id", userId).order("name").limit(50);
        } else if (selected === "events") {
          result = await supabase.from("events").select("id,title").order("title").limit(50);
        } else {
          const friendshipResult = await supabase.from("friendships")
            .select("requester_id,addressee_id").eq("status", "accepted")
            .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).limit(100);
          if (friendshipResult.error) {
            result = { data: null, error: friendshipResult.error };
          } else {
            const friendIds = (friendshipResult.data || []).map((friendship) =>
              friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id);
            result = friendIds.length
              ? await supabase.from("profiles").select("id,display_name").in("id", friendIds).order("display_name").limit(100)
              : { data: [], error: null };
          }
        }
        if (!active) return;
        if (result.error) throw new Error(result.error.message || "Could not load audience choices.");
        const nextItems = (result.data || []).map((item) => {
          const row = item as { id: string; name?: string; title?: string; display_name?: string };
          return { id: row.id, label: row.name || row.title || row.display_name || "Unnamed member" };
        });
        setItems(nextItems);
        setSelectedIds((current) => normalizeAudienceSubjectIds(
          selected,
          current.filter((id) => nextItems.some((item) => item.id === id)),
        ));
      } catch (cause) {
        if (!active) return;
        setItems([]);
        setItemsError(cause instanceof Error ? cause.message : "Could not load audience choices.");
      } finally {
        if (active) setLoadingItems(false);
      }
    })();
    return () => { active = false; };
  }, [selected, retryCount]);

  const toggleSubject = (id: string) => {
    setSelectedIds((current) => toggleAudienceSubjectId(selected, current, id));
  };

  const done = () => {
    const needsSubjects = selected !== "friends" && selected !== "private";
    const eligibleIds = new Set(items.map((item) => item.id));
    const validSelectedIds = normalizeAudienceSubjectIds(selected, selectedIds.filter((id) => eligibleIds.has(id)));
    if (needsSubjects && (!validSelectedIds.length || loadingItems)) return;
    router.push(`/create?audience=${selected}&subjects=${needsSubjects ? validSelectedIds.join(",") : ""}`);
  };

  return (
    <PageShell>
      <MobileHeader title="Who can see this?" backHref="/create" />
      <div className="audience-summary">
        {options.map(({ id, title, sub, Icon }) => (
          <div
            key={id}
            className={`audience-card ${selected === id ? "selected" : ""}`}
            onClick={() => { setSelected(id); setSelectedIds([]); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelected(id);
                setSelectedIds([]);
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={selected === id}
          >
            <div className="row gap10">
              <Icon size={18} color={selected === id ? "var(--teal)" : "var(--muted)"} />
              <div>
                <div className="audience-title">{title}</div>
                <div className="audience-sub">{sub}</div>
                {selected === id && id !== "friends" ? (
                  <div className="audience-chips">
                    {loadingItems ? <span className="audience-chip" role="status">Loading…</span> : itemsError ? <span className="audience-error" role="alert"><span>{itemsError}</span><button type="button" className="text-btn" onClick={(event) => { event.stopPropagation(); setRetryCount((count) => count + 1); }}>Retry</button></span> : items.length ? items.map((item) => (
                      <button type="button" key={item.id} className={`audience-chip ${selectedIds.includes(item.id) ? "selected" : ""}`} onClick={(event) => { event.stopPropagation(); toggleSubject(item.id); }}>
                        {item.label}{selectedIds.includes(item.id) ? " ×" : ""}
                      </button>
                    )) : <span className="audience-chip">No choices available yet</span>}
                  </div>
                ) : null}
              </div>
            </div>
            <span className="audience-check"><Check size={13} /></span>
          </div>
        ))}
      </div>
      {selected !== "friends" && !selectedIds.length ? <div className="form-hint">{selected === "events" ? "Choose one event for this post." : "Choose at least one option to keep this post private to the right people."}</div> : null}
      <button className="primary-btn" style={{ width: "100%" }} onClick={done} disabled={selected !== "friends" && (!selectedIds.length || loadingItems || !!itemsError)}>Done</button>
    </PageShell>
  );
}

export default function AudiencePicker() {
  return (
    <Suspense fallback={<div className="feed-loader" aria-label="Loading audience picker"><span /></div>}>
      <AudiencePickerForm />
    </Suspense>
  );
}