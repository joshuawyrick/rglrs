"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, MapPin, UserMinus, UserRound, UsersRound, X } from "lucide-react";
import { normalizeAudienceSubjectIds, toggleAudienceSubjectId } from "@/lib/audience-selection";
import { getCurrentUserId, isSupabaseAvailable, type AudienceType } from "@/lib/post-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PlacePicker, type PlaceValue } from "@/components/place-picker";

const options: { id: AudienceType; title: string; sub: string; Icon: typeof UsersRound }[] = [
  { id: "private", title: "Only me", sub: "Keep this post private", Icon: UsersRound },
  { id: "friends", title: "Friends", sub: "All your friends", Icon: UsersRound },
  { id: "circles", title: "Circles", sub: "Choose one or more circles", Icon: UsersRound },
  { id: "events", title: "Events", sub: "Share to an event", Icon: CalendarDays },
  { id: "people", title: "Specific People", sub: "Choose people", Icon: UserRound },
  { id: "except", title: "Everyone Except", sub: "Hide from people", Icon: UserMinus },
];

type AudienceItem = { id: string; label: string };
type EventSharingMember = { id: string; name: string; avatar: string };

export function AudienceDialog({
  open,
  audience,
  subjectIds,
  onClose,
  onSave,
}: {
  open: boolean;
  audience: AudienceType;
  subjectIds: string[];
  onClose: () => void;
  onSave: (audience: AudienceType, subjectIds: string[]) => void;
}) {
  const [selected, setSelected] = useState(audience);
  const [selectedIds, setSelectedIds] = useState(subjectIds);
  const [items, setItems] = useState<AudienceItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(audience);
    setSelectedIds(normalizeAudienceSubjectIds(audience, subjectIds));
    window.setTimeout(() => dialogRef.current?.focus(), 0);
  }, [open, audience, subjectIds]);

  useEffect(() => {
    if (!open) return;
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
    void (async () => {
      setLoadingItems(true);
      setItemsError(null);
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
          const friendships = await supabase.from("friendships")
            .select("requester_id,addressee_id").eq("status", "accepted")
            .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).limit(100);
          if (friendships.error) {
            result = { data: null, error: friendships.error };
          } else {
            const friendIds = (friendships.data || []).map((friendship) =>
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
      } catch (error) {
        if (!active) return;
        setItems([]);
        setItemsError(error instanceof Error ? error.message : "Could not load audience choices.");
      } finally {
        if (active) setLoadingItems(false);
      }
    })();
    return () => { active = false; };
  }, [open, selected, retryCount]);

  if (!open) return null;
  const needsSubjects = selected !== "friends" && selected !== "private";
  const validIds = selectedIds.filter((id) => items.some((item) => item.id === id));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="composer-dialog glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audience-dialog-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      >
        <div className="row space">
          <h2 id="audience-dialog-title">Who can see this?</h2>
          <button className="screen-icon-btn" type="button" onClick={onClose} aria-label="Close audience picker"><X size={18} /></button>
        </div>
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
                      {loadingItems ? <span className="audience-chip" role="status">Loading…</span> : itemsError ? (
                        <span className="audience-error" role="alert">
                          <span>{itemsError}</span>
                          <button type="button" className="text-btn" onClick={(event) => { event.stopPropagation(); setRetryCount((count) => count + 1); }}>Retry</button>
                        </span>
                      ) : items.length ? items.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={`audience-chip ${selectedIds.includes(item.id) ? "selected" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedIds((current) => toggleAudienceSubjectId(selected, current, item.id));
                          }}
                        >
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
        {needsSubjects && !validIds.length ? <div className="form-hint">{selected === "events" ? "Choose one event for this post." : "Choose at least one option to keep this post private to the right people."}</div> : null}
        <button
          className="primary-btn"
          type="button"
          style={{ width: "100%" }}
          disabled={needsSubjects && (!validIds.length || loadingItems || !!itemsError)}
          onClick={() => onSave(selected, needsSubjects ? normalizeAudienceSubjectIds(selected, validIds) : [])}
        >
          Done
        </button>
      </div>
    </div>
  );
}

export function EventSharingDialog({
  open,
  eventId,
  onClose,
  onSaved,
}: {
  open: boolean;
  eventId: string | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [members, setMembers] = useState<EventSharingMember[]>([]);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !eventId) return;
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const userId = await getCurrentUserId();
        if (!supabase || !userId) throw new Error("Sign in to manage event sharing.");
        const [membershipResult, exclusionResult] = await Promise.all([
          supabase.from("event_members").select("user_id").eq("event_id", eventId),
          supabase.from("event_media_exclusions").select("excluded_user_id").eq("event_id", eventId).eq("uploader_id", userId),
        ]);
        if (membershipResult.error) throw membershipResult.error;
        if (exclusionResult.error) throw exclusionResult.error;
        const memberIds = (membershipResult.data || []).map((member) => member.user_id).filter((id) => id !== userId);
        const profileResult = memberIds.length
          ? await supabase.from("profiles").select("id,display_name,avatar_key").in("id", memberIds).order("display_name")
          : { data: [], error: null };
        if (profileResult.error) throw profileResult.error;
        if (!active) return;
        setMembers((profileResult.data || []).map((profile) => ({
          id: profile.id,
          name: profile.display_name || "RGLR",
          avatar: profile.avatar_key?.startsWith("http") || profile.avatar_key?.startsWith("/private-media/")
            ? profile.avatar_key
            : `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(profile.display_name || profile.id)}`,
        })));
        setExcludedIds((exclusionResult.data || []).map((row) => row.excluded_user_id));
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load sharing choices.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [open, eventId]);

  const save = async () => {
    if (!eventId) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Sharing controls are unavailable.");
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.rpc("set_event_media_sharing_secure", {
      p_event: eventId,
      p_excluded_users: excludedIds,
    });
    setSaving(false);
    if (saveError) return setError("Could not save your sharing choices.");
    onSaved?.();
    onClose();
  };

  if (!open || !eventId) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="composer-dialog glass" role="dialog" aria-modal="true" aria-labelledby="event-sharing-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="row space">
          <h2 id="event-sharing-dialog-title">My event sharing</h2>
          <button className="screen-icon-btn" type="button" onClick={onClose} aria-label="Close event sharing"><X size={18}/></button>
        </div>
        <p className="form-hint">People you hide from remain event members and can still see other contributors’ permitted media. Your choice applies to your existing and future uploads.</p>
        {loading ? <div className="feed-loader" aria-label="Loading sharing choices"><span/></div> : null}
        {!loading && !members.length && !error ? <div className="form-hint">There are no other members to manage.</div> : null}
        {!loading ? members.map((member) => {
          const excluded = excludedIds.includes(member.id);
          return <label className="event-sharing-member" key={member.id}>
            <img className="avatar" src={member.avatar} width={34} height={34} alt=""/>
            <span className="conversation-main"><span className="conversation-name">{member.name}</span><span className="conversation-preview">{excluded ? "Cannot see your event media" : "Can see your event media"}</span></span>
            <input type="checkbox" checked={excluded} onChange={() => setExcludedIds((current) => excluded ? current.filter((id) => id !== member.id) : [...current, member.id])} aria-label={`Hide my event media from ${member.name}`}/>
          </label>;
        }) : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="primary-btn" type="button" style={{width:"100%",marginTop:12}} disabled={loading || saving || !!error} onClick={save}>{saving ? "Saving…" : "Save sharing"}</button>
      </div>
    </div>
  );
}

export function LocationDialog({
  open,
  location,
  address,
  onClose,
  onSave,
}: {
  open: boolean;
  location: string;
  address?: string;
  onClose: () => void;
  onSave: (location: string, address: string) => void;
}) {
  const [value, setValue] = useState<PlaceValue>({ name: location, address: address || "" });

  useEffect(() => {
    if (open) setValue({ name: location, address: address || "" });
  }, [open, location, address]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="composer-dialog glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
      >
        <div className="row space">
          <h2 id="location-dialog-title">Add location</h2>
          <button className="screen-icon-btn" type="button" onClick={onClose} aria-label="Close location picker"><X size={18} /></button>
        </div>
        <p className="form-hint">Search for a venue, neighborhood, city, or address. You can also enter your own label.</p>
        <label className="form-label" htmlFor="post-location">Location</label>
        <PlacePicker id="post-location" autoFocus value={value} onChange={setValue} placeholder="Search or enter a place" />
        <div className="location-dialog-actions">
          {location ? <button className="secondary-btn" type="button" onClick={() => onSave("", "")}>Remove</button> : null}
          <button className="primary-btn" type="button" onClick={() => onSave(value.name.trim(), value.address.trim())} disabled={!value.name.trim()}>Add location</button>
        </div>
      </div>
    </div>
  );
}