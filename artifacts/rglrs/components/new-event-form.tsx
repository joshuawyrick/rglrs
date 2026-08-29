"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { CalendarDays, Camera, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { EventSummary } from "@/lib/event-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PlacePicker, type PlaceValue } from "@/components/place-picker";
import { DateRangeCalendar } from "@/components/date-range-calendar";

type DraftDates = { startDate: string; startTime: string; endDate: string; endTime: string };

function localParts(value: string | null, timezone?: string | null): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone:timezone, year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", hourCycle:"h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
    return { date:`${part("year")}-${part("month")}-${part("day")}`, time:`${part("hour")}:${part("minute")}` };
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function dateValue(date: string, time: string, allDay: boolean, timezone: string) {
  if (!date) return null;
  const clock = allDay ? "00:00" : time || "00:00";
  const localGuess = new Date(`${date}T${clock}:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone:timezone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23",
  });
  const zonedParts = formatter.formatToParts(localGuess);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(zonedParts.find((item) => item.type === type)?.value || 0);
  const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  const value = new Date(localGuess.getTime() - (represented - localGuess.getTime()));
  return Number.isNaN(value.getTime()) ? null : value;
}

function dateSummary(dates: DraftDates, allDay: boolean) {
  if (!dates.startDate) return "Add date and time";
  const start = new Date(`${dates.startDate}T${allDay ? "00:00" : dates.startTime || "00:00"}`);
  const first = start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = allDay ? "All day" : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!dates.endDate) return `${first} · ${time}`;
  const end = new Date(`${dates.endDate}T${allDay ? "00:00" : dates.endTime || "00:00"}`);
  return `${first} · ${time} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

async function uploadCover(file: File) {
  const prepared = await fetch("/private-media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, fileName: file.name, size: file.size }),
  });
  const body = await prepared.json().catch(() => null) as {
    uploadId?: string; uploadUrl?: string; fallbackUploadUrl?: string;
    headers?: Record<string, string>; error?: string;
  } | null;
  if (!prepared.ok || !body?.uploadId || !body.uploadUrl || !body.fallbackUploadUrl || !body.headers) {
    throw new Error(body?.error || "Could not prepare the cover upload.");
  }
  try {
    const direct = await fetch(body.uploadUrl, { method: "PUT", headers: body.headers, body: file });
    if (!direct.ok) throw new Error("Direct upload failed");
  } catch {
    const fallback = await fetch(body.fallbackUploadUrl, {
      method: "PUT", headers: { "Content-Type": file.type }, body: file,
    });
    if (!fallback.ok) {
      const detail = await fallback.json().catch(() => null) as { error?: string } | null;
      throw new Error(detail?.error || "Could not upload the event cover.");
    }
  }
  const completed = await fetch(`/private-media/uploads/${body.uploadId}/complete`, { method: "POST" });
  const completedBody = await completed.json().catch(() => null) as { uploadId?: string; error?: string } | null;
  if (!completed.ok || completedBody?.uploadId !== body.uploadId) {
    throw new Error(completedBody?.error || "Event cover validation failed.");
  }
  return body.uploadId;
}

export function EventForm({ event }: { event?: EventSummary }) {
  const router = useRouter();
  const timezone = event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const start = localParts(event?.startsAt || null, event?.timezone);
  const end = localParts(event?.endsAt || null, event?.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [place, setPlace] = useState<PlaceValue>({ name: event?.placeName || "", address: event?.placeAddress || "" });
  const [dates, setDates] = useState<DraftDates>({ startDate:start.date, startTime:start.time, endDate:end.date, endTime:end.time });
  const [dateDraft, setDateDraft] = useState(dates);
  const [allDay, setAllDay] = useState(event?.allDay || false);
  const [dateOpen, setDateOpen] = useState(false);
  const [coverUploadId, setCoverUploadId] = useState<string | null>(event?.coverUploadId || null);
  const [coverPreview, setCoverPreview] = useState<string | null>(event?.coverUrl || null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [clearCover, setClearCover] = useState(false);
  const createdDraft = useRef<string | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => {
    if (createdDraft.current) void fetch(`/private-media/uploads/${createdDraft.current}`, { method: "DELETE" });
  }, []);

  useEffect(() => {
    if (!dateOpen) return;
    sheetRef.current?.focus();
    const close = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") setDateOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [dateOpen]);

  async function chooseCover(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    change.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError("Choose a JPG, PNG, or WebP cover.");
    if (file.size < 1 || file.size > 15 * 1024 * 1024) return setError("Event covers must be 15 MB or smaller.");
    setCoverBusy(true); setError(null);
    try {
      if (createdDraft.current) await fetch(`/private-media/uploads/${createdDraft.current}`, { method: "DELETE" });
      const uploadId = await uploadCover(file);
      createdDraft.current = uploadId;
      setCoverUploadId(uploadId);
      setCoverPreview(URL.createObjectURL(file));
      setClearCover(false);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload the event cover.");
    } finally {
      setCoverBusy(false);
    }
  }

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const form = new FormData(submitEvent.currentTarget);
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const placeName = place.name.trim();
    const placeAddress = place.address.trim();
    if (!title) return setError("Event name is required.");
    if (title.length > 140 || placeName.length > 200 || placeAddress.length > 240 || description.length > 5000) {
      return setError("One or more event details are too long.");
    }
    const startDate = dateValue(dates.startDate, dates.startTime, allDay, timezone);
    const endDate = dateValue(dates.endDate, dates.endTime, allDay, timezone);
    if (dates.startDate && !startDate || dates.endDate && !endDate) return setError("Enter valid event dates.");
    if (endDate && !startDate) return setError("Choose a start date before an end date.");
    if (startDate && endDate && endDate < startDate) return setError("End date must be after the start date.");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Events are unavailable.");
    setBusy(true); setError(null);
    const common = {
      p_title:title, p_description:description,
      p_starts_at:startDate?.toISOString() || null, p_ends_at:endDate?.toISOString() || null,
      p_place_name:placeName || null, p_place_address:placeAddress || null,
      p_members_can_invite:form.get("membersCanInvite") === "on",
      p_all_day:allDay, p_timezone:timezone, p_cover_upload_id:coverUploadId,
    };
    const result = event
      ? await supabase.rpc("update_event_secure", { p_event:event.id, ...common, p_clear_cover:clearCover })
      : await supabase.rpc("create_event_secure", common);
    setBusy(false);
    if (result.error || (event ? result.data !== true : typeof result.data !== "string")) {
      return setError(`Could not ${event ? "update" : "create"} the event. Please check the details and try again.`);
    }
    createdDraft.current = null;
    router.push(event ? `/events/${event.id}` : `/events/${result.data}`);
    router.refresh();
  }

  function removeCover() {
    if (createdDraft.current) void fetch(`/private-media/uploads/${createdDraft.current}`, { method: "DELETE" });
    createdDraft.current = null;
    setCoverUploadId(null);
    setCoverPreview(null);
    setClearCover(true);
  }

  return (
    <form className="new-event-form" onSubmit={submit}>
      <div className="event-cover-editor">
        {coverPreview ? <img src={coverPreview} alt="Event cover preview"/> : <div className="event-cover-fallback"/>}
        <div className="event-cover-actions">
          <label className="secondary-btn">
            <Camera size={18}/>
            {coverBusy ? "Uploading…" : coverPreview ? "Replace cover" : "Add cover"}
            <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={chooseCover} disabled={busy || coverBusy}/>
          </label>
          {coverPreview ? (
            <button type="button" className="secondary-btn" onClick={removeCover} disabled={busy || coverBusy}>
              <X size={18}/> Remove
            </button>
          ) : null}
        </div>
      </div>

      <label>
        <span className="form-label">Event name <em>required</em></span>
        <input className="input" name="title" defaultValue={event?.title} maxLength={140} placeholder="Saturday dinner" required/>
      </label>

      <div>
        <span className="form-label">Dates <em>optional</em></span>
        <button type="button" className="event-date-trigger" onClick={() => { setDateDraft(dates); setDateOpen(true); }} aria-haspopup="dialog">
          <CalendarDays size={20}/>
          <span>{dateSummary(dates, allDay)}</span>
        </button>
      </div>

      <label>
        <span className="form-label">Location <em>optional</em></span>
        <PlacePicker id={`event-location-${event?.id || "new"}`} value={place} onChange={setPlace} placeholder="Search for a venue or address"/>
      </label>

      <label>
        <span className="form-label">Description <em>optional</em></span>
        <textarea className="input composer-textarea" name="description" rows={4} maxLength={5000} defaultValue={event?.description} placeholder="What should guests know?"/>
      </label>

      <label className="composer-option">
        <div>
          <div>Let members invite others</div>
          <div className="event-option-help">You and admins can always invite people</div>
        </div>
        <input type="checkbox" name="membersCanInvite" defaultChecked={event?.membersCanInvite}/>
      </label>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      <button className="primary-btn" disabled={busy || coverBusy} style={{ marginTop: 8 }}>
        {busy ? "Saving event…" : event ? "Save changes" : "Create event"}
      </button>

      {dateOpen ? (
        <div className="event-sheet-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDateOpen(false); }}>
          <section ref={sheetRef} tabIndex={-1} className="event-date-sheet" role="dialog" aria-modal="true" aria-labelledby="event-date-title">
            <div className="event-sheet-handle"/>
            <div className="row space">
              <h2 id="event-date-title" style={{ margin: 0, fontSize: 16 }}>Event dates</h2>
              <button type="button" className="icon-button" onClick={() => setDateOpen(false)} aria-label="Close date picker"><X size={20}/></button>
            </div>

            <DateRangeCalendar
              startDate={dateDraft.startDate}
              endDate={dateDraft.endDate}
              onChange={(startDate, endDate) => setDateDraft((current) => ({ ...current, startDate, endDate }))}
            />

            <label className="composer-option" style={{ minHeight: 64 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>All-day event</span>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)}/>
            </label>

            {!allDay && dateDraft.startDate ? (
              <div className="form-two">
                <label>
                  <span className="form-label">Start time</span>
                  <input className="input" type="time" value={dateDraft.startTime} onChange={(e) => setDateDraft({...dateDraft,startTime:e.target.value})}/>
                </label>
                <label>
                  <span className="form-label">End time</span>
                  <input className="input" type="time" value={dateDraft.endTime} onChange={(e) => setDateDraft({...dateDraft,endTime:e.target.value})}/>
                </label>
              </div>
            ) : null}

            <p className="event-timezone">Times use {timezone.replaceAll("_", " ")}.</p>

            <div className="form-two">
              <button type="button" className="secondary-btn" onClick={() => { setDates({startDate:"",startTime:"",endDate:"",endTime:""}); setDateOpen(false); }}>Clear</button>
              <button type="button" className="primary-btn" disabled={!dateDraft.startDate} onClick={() => {
                const normalized = dateDraft.endDate ? dateDraft : { ...dateDraft, endDate: dateDraft.startDate };
                setDates(normalized);
                setDateOpen(false);
              }}>Apply</button>
            </div>
          </section>
        </div>
      ) : null}
    </form>
  );
}

export function NewEventForm() {
  return <EventForm/>;
}
