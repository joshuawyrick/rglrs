"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { ChevronRight, Download, ImagePlus, MapPin, RotateCcw, Tag, Trash2, UsersRound, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { AudienceDialog, LocationDialog } from "@/components/post-options-dialogs";
import { normalizeAudienceSubjectIds } from "@/lib/audience-selection";
import { createPost, getCurrentUserId, isSupabaseAvailable, type AudienceType, type PostMediaInput } from "@/lib/post-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const audienceLabels: Record<AudienceType, string> = {
  private: "Only me",
  friends: "Friends",
  circles: "Circles",
  events: "Events",
  people: "Specific People",
  except: "Everyone Except",
};

type UploadState = "idle" | "validating" | "uploading" | "finalizing" | "ready" | "failed";
type UploadItem = { id: string; file: File; previewUrl: string; state: UploadState; progress: number; error?: string; media?: PostMediaInput };

async function inspectImageDimensions(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("The source image could not be decoded."));
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function inspectFile(file: File) {
  const image = file.type.startsWith("image/");
  const maxBytes = image ? 15 * 1024 * 1024 : 100 * 1024 * 1024;
  if (file.size < 1 || file.size > maxBytes) throw new Error(image ? "Photos must be 15 MB or smaller." : "Videos must be 100 MB or smaller.");
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const ascii = new TextDecoder("ascii").decode(bytes);
  const valid = file.type === "image/jpeg"
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : file.type === "image/png"
      ? bytes.slice(0, 8).every((value, index) => value === [137,80,78,71,13,10,26,10][index])
      : file.type === "image/webp"
        ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
        : ["video/mp4","video/quicktime"].includes(file.type)
          ? ascii.slice(4, 12).includes("ftyp")
          : false;
  if (!valid) throw new Error("The file contents do not match a supported photo or video format.");
  if (image) {
    const dimensions = await inspectImageDimensions(file);
    if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 12000 || dimensions.height > 12000) throw new Error("Image dimensions are unsupported.");
    return dimensions;
  }
  const url = URL.createObjectURL(file);
  try {
    const durationMs = await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => resolve(Math.round(video.duration * 1000));
      video.onerror = () => reject(new Error("Video metadata could not be read."));
      video.src = url;
    });
    if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 180000) throw new Error("Videos must be 3 minutes or shorter.");
    return { durationMs };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function putWithProgress(url: string, headers: Record<string, string>, file: File, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onerror = () => reject(new Error("Could not upload media."));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Could not upload media."));
    xhr.send(file);
  });
}

async function uploadFile(file: File, onState: (state: UploadState, progress?: number) => void): Promise<PostMediaInput> {
  onState("validating");
  await inspectFile(file);
  const response = await fetch("/private-media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type, fileName: file.name, size: file.size }),
  });
  const payload = await response.json().catch(() => null) as { uploadId?: string; uploadUrl?: string; fallbackUploadUrl?: string; headers?: Record<string,string>; error?: string } | null;
  if (!response.ok || !payload?.uploadUrl || !payload.fallbackUploadUrl || !payload.uploadId || !payload.headers) {
    throw new Error(payload?.error || "Could not prepare media upload.");
  }
  try {
    onState("uploading", 0);
    try {
      await putWithProgress(payload.uploadUrl, payload.headers, file, (progress) => onState("uploading", progress));
    } catch {
      onState("uploading", 0);
      await putWithProgress(payload.fallbackUploadUrl, { "Content-Type": file.type }, file, (progress) => onState("uploading", progress));
    }
    onState("finalizing", 100);
    const completed = await fetch(`/private-media/uploads/${payload.uploadId}/complete`, { method: "POST" });
    const result = await completed.json().catch(() => null) as { uploadId?: string; mediaType?: "image"|"video"; width?: number; height?: number; durationMs?: number; error?: string } | null;
    if (!completed.ok || !result?.uploadId || !result.mediaType) throw new Error(result?.error || "Media validation failed.");
    return { uploadId: result.uploadId, mediaType: result.mediaType, width: result.width, height: result.height, durationMs: result.durationMs, sortOrder: 0 };
  } catch (error) {
    await fetch(`/private-media/uploads/${payload.uploadId}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

function CreatePostComposer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const audienceParam = searchParams.get("audience") as AudienceType | null;
  const subjectsParam = searchParams.get("subjects") || "";
  const downloadsParam = searchParams.get("allow_downloads");
  const [audience, setAudience] = useState<AudienceType>(audienceParam && audienceParam in audienceLabels ? audienceParam : "friends");
  const [subjectIds, setSubjectIds] = useState(() => normalizeAudienceSubjectIds(
    audienceParam && audienceParam in audienceLabels ? audienceParam : "friends",
    subjectsParam.split(","),
  ));
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [caption, setCaption] = useState("");
  const [allowDownloads, setAllowDownloads] = useState(downloadsParam === "true");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const uploadsRef = useRef<UploadItem[]>([]);
  const publishedRef = useRef(false);
  const audienceChosenRef = useRef(audienceParam !== null);
  const subjectsChosenRef = useRef(searchParams.has("subjects"));
  const downloadsChosenRef = useRef(downloadsParam !== null);

  useEffect(() => {
    setConfigured(isSupabaseAvailable());
    const draft = window.sessionStorage.getItem("rglrs-post-caption");
    if (draft) setCaption(draft);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    void supabase.rpc("get_privacy_settings_secure").then(({ data, error }) => {
      if (!active || error || !data || typeof data !== "object") return;
      const privacy = data as {
        settings?: { default_post_audience_kind?: string; default_media_downloads?: boolean };
        default_rules?: Array<{ scope?: string; rule_type?: string; subject_id?: string | null }>;
      };
      const defaultAudience = privacy.settings?.default_post_audience_kind;
      if (!audienceChosenRef.current && defaultAudience && defaultAudience in audienceLabels) {
        const nextAudience = defaultAudience as AudienceType;
        setAudience(nextAudience);
        if (!subjectsChosenRef.current) {
          const matchingRule = nextAudience === "friends" ? "include_friends"
            : nextAudience === "circles" ? "include_circle"
              : nextAudience === "events" ? "include_event"
                : nextAudience === "people" ? "include_user"
                  : nextAudience === "except" ? "exclude_user" : "";
          setSubjectIds(normalizeAudienceSubjectIds(nextAudience, (privacy.default_rules || [])
            .filter((rule) => rule.scope === "post" && rule.rule_type === matchingRule)
            .flatMap((rule) => rule.subject_id ? [rule.subject_id] : [])));
        }
      }
      if (!downloadsChosenRef.current && typeof privacy.settings?.default_media_downloads === "boolean") {
        setAllowDownloads(privacy.settings.default_media_downloads);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem("rglrs-post-caption", caption);
  }, [caption]);

  useEffect(() => {
    const eventId = audience === "events" && subjectIds.length === 1 ? subjectIds[0] : null;
    if (!eventId) return;
    setLocationName("");
    setLocationAddress("");
    let active = true;
    void fetch(`/events/${eventId}/location`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { name?: string; address?: string } | null;
        if (!active || !response.ok || !data) return;
        setLocationName(data.name || "");
        setLocationAddress(data.address || "");
      }).catch(() => undefined);
    return () => { active = false; };
  }, [audience, subjectIds]);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);
  useEffect(() => () => {
    for (const upload of uploadsRef.current) {
      URL.revokeObjectURL(upload.previewUrl);
      if (upload.media && !publishedRef.current) {
        void fetch(`/private-media/uploads/${upload.media.uploadId}`, { method: "DELETE", keepalive: true });
      }
    }
  }, []);

  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = Array.from(event.target.files || []).slice(0, 8).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      state: "idle" as const,
      progress: 0,
    }));
    for (const upload of uploads) {
      URL.revokeObjectURL(upload.previewUrl);
      if (upload.media) void fetch(`/private-media/uploads/${upload.media.uploadId}`, { method: "DELETE" });
    }
    setUploads(next);
  };

  const updateUpload = (id: string, patch: Partial<UploadItem>) => setUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const runUpload = async (item: UploadItem, index: number) => {
    try {
      const media = await uploadFile(item.file, (state, progress) => updateUpload(item.id, { state, progress: progress ?? item.progress, error: undefined }));
      const ready = { ...media, sortOrder: index };
      updateUpload(item.id, { state: "ready", progress: 100, media: ready, error: undefined });
      return ready;
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Could not upload media.";
      updateUpload(item.id, { state: "failed", error: message });
      throw new Error(message);
    }
  };
  const removeUpload = (item: UploadItem) => {
    URL.revokeObjectURL(item.previewUrl);
    if (item.media) void fetch(`/private-media/uploads/${item.media.uploadId}`, { method: "DELETE" });
    setUploads((current) => current.filter((candidate) => candidate.id !== item.id));
  };

  const handleShare = async () => {
    setError(null);
    if (!configured) {
      setError("Connect Supabase before sharing a real post.");
      return;
    }
    if (!caption.trim() && uploads.length === 0) {
      setError("Add a caption or choose some media first.");
      return;
    }
    setSubmitting(true);
    try {
      const userId = await getCurrentUserId();
      if (!userId) throw new Error("Sign in to share a post.");
      const media: PostMediaInput[] = [];
      for (const [index, item] of uploads.entries()) {
        media.push(item.media ? { ...item.media, sortOrder: index } : await runUpload(item, index));
      }
      try {
        await createPost({
          caption,
          audience: audienceChosenRef.current ? audience : null,
          subjectIds: audienceChosenRef.current ? normalizeAudienceSubjectIds(audience, subjectIds) : [],
          media,
          locationName,
          locationAddress,
          allowDownloads: downloadsChosenRef.current ? allowDownloads : null,
        });
        publishedRef.current = true;
      } catch (postError) {
        await Promise.all(media.map((item) => fetch(`/private-media/uploads/${item.uploadId}`, { method: "DELETE" }).catch(() => undefined)));
        setUploads((current) => current.map((item) => ({ ...item, state: "idle", progress: 0, media: undefined })));
        throw postError;
      }
      window.sessionStorage.removeItem("rglrs-post-caption");
      router.push("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not share your post.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <MobileHeader title="New Post" backHref="/" right={<Link className="screen-icon-btn" href="/" aria-label="Close"><X size={18} /></Link>} />
      <div className="composer-context-link"><span>Sharing a post</span><Link href="/events/new">Planning an event? Create one</Link></div>
      <div className="composer">
        <label className="composer-media-picker">
          <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" multiple onChange={handleFiles} />
          <ImagePlus size={18} />
          <span>{uploads.length ? `${uploads.length} selected` : "Add photos or videos"}</span>
        </label>
        {uploads.length ? (
          <div className="composer-media-row">
            {uploads.map((item) => (
              <div className="composer-upload-item" key={item.id}>
                {item.file.type.startsWith("video/")
                  ? <video className="composer-media-preview" src={item.previewUrl} muted />
                  : <img className="composer-media-preview" src={item.previewUrl} alt="Selected media" />}
                <button type="button" className="composer-remove-media" onClick={() => removeUpload(item)} aria-label={`Remove ${item.file.name}`}><Trash2 size={12} /></button>
                <div className="composer-upload-status">
                  <span>{item.state === "uploading" ? `${item.progress}%` : item.state === "ready" ? "Ready" : item.state === "failed" ? "Failed" : item.state === "finalizing" ? "Checking" : item.state === "validating" ? "Checking" : "Waiting"}</span>
                  {item.state === "uploading" ? <i style={{ width: `${item.progress}%` }} /> : null}
                  {item.state === "failed" ? <button type="button" onClick={() => void runUpload(item, uploads.indexOf(item))}><RotateCcw size={10} /> Retry</button> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className="input composer-textarea"
          placeholder="Add a caption…"
          maxLength={220}
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
        />
        <div style={{ textAlign: "right", fontSize: 7.5, color: "var(--muted-2)", marginTop: -8, marginBottom: 8 }}>{caption.length}/220</div>
        <button className="composer-option" type="button" onClick={() => setLocationOpen(true)}>
          <div className="left"><MapPin size={16} /><div><div>{locationName || "Add location"}</div>{locationAddress ? <div className="composer-option-value">{locationAddress}</div> : locationName ? <div className="composer-option-value">Location added</div> : null}</div></div>
          <ChevronRight size={16} color="var(--muted-2)" />
        </button>
        <div className="composer-option"><div className="left"><Tag size={16} /><span>Tag people</span></div><ChevronRight size={16} color="var(--muted-2)" /></div>
        <button className="composer-option" type="button" onClick={() => setAudienceOpen(true)}>
          <div className="left"><UsersRound size={16} /><div><div>Who can see this?</div><div style={{ color: "var(--teal)", fontSize: 8, marginTop: 3 }}>{audienceLabels[audience]}</div></div></div>
          <ChevronRight size={16} color="var(--muted-2)" />
        </button>
        <label className="composer-option composer-toggle-option">
          <div className="left"><Download size={16} /><div><div>Allow downloads</div><div className="composer-option-value muted">{allowDownloads ? "People who can view this post can save its media" : "Off by default because saved copies cannot be revoked"}</div></div></div>
          <input type="checkbox" checked={allowDownloads} onChange={(event) => { downloadsChosenRef.current = true; setAllowDownloads(event.target.checked); }} aria-label="Allow viewers to download this post's media" />
        </label>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <button className="primary-btn" style={{ width: "100%", marginTop: 14 }} onClick={handleShare} disabled={submitting || uploads.some((item) => ["validating","uploading","finalizing"].includes(item.state))}>
          {submitting ? "Sharing…" : "Share"}
        </button>
      </div>
      <AudienceDialog
        open={audienceOpen}
        audience={audience}
        subjectIds={subjectIds}
        onClose={() => setAudienceOpen(false)}
        onSave={(nextAudience, nextSubjects) => {
          audienceChosenRef.current = true;
          subjectsChosenRef.current = true;
          setAudience(nextAudience);
          setSubjectIds(nextSubjects);
          setAudienceOpen(false);
        }}
      />
      <LocationDialog
        open={locationOpen}
        location={locationName}
        address={locationAddress}
        onClose={() => setLocationOpen(false)}
        onSave={(nextLocation, nextAddress) => {
          setLocationName(nextLocation);
          setLocationAddress(nextAddress);
          setLocationOpen(false);
        }}
      />
    </PageShell>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="feed-loader" aria-label="Loading composer"><span /></div>}>
      <CreatePostComposer />
    </Suspense>
  );
}