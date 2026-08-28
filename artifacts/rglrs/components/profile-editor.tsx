"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Camera } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type ProfileRecord = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_key: string | null;
  avatar_upload_id: string | null;
  is_founder: boolean;
};

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "R";
}

export function ProfileEditor({ initialProfile, email }: { initialProfile: ProfileRecord; email: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [draft, setDraft] = useState({
    display_name: initialProfile.display_name,
    username: initialProfile.username,
    bio: initialProfile.bio ?? "",
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [avatarError, setAvatarError] = useState("");

  const avatarInitials = useMemo(() => initials(profile.display_name), [profile.display_name]);

  function beginEditing() {
    setDraft({
      display_name: profile.display_name,
      username: profile.username,
      bio: profile.bio ?? "",
    });
    setError("");
    setMessage("");
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
    setError("");
    setMessage("");
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setAvatarError("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size < 1 || file.size > 15 * 1024 * 1024) {
      setAvatarError("Profile photos must be 15 MB or smaller.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setAvatarError("Supabase is not configured yet.");
      return;
    }

    setAvatarBusy(true);
    try {
      const response = await fetch("/private-media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, fileName: file.name, size: file.size }),
      });
      const payload = await response.json().catch(() => null) as {
        uploadId?: string;
        uploadUrl?: string;
        fallbackUploadUrl?: string;
        headers?: Record<string, string>;
        error?: string;
      } | null;
      if (!response.ok || !payload?.uploadId || !payload.uploadUrl || !payload.fallbackUploadUrl || !payload.headers) {
        throw new Error(payload?.error || "Could not prepare profile photo upload.");
      }

      try {
        const direct = await fetch(payload.uploadUrl, { method: "PUT", headers: payload.headers, body: file });
        if (!direct.ok) throw new Error("Direct upload failed");
      } catch {
        const fallback = await fetch(payload.fallbackUploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!fallback.ok) {
          const fallbackBody = await fallback.json().catch(() => null) as { error?: string } | null;
          throw new Error(fallbackBody?.error || "Could not upload profile photo.");
        }
      }

      const completed = await fetch(`/private-media/uploads/${payload.uploadId}/complete`, { method: "POST" });
      const completedBody = await completed.json().catch(() => null) as { uploadId?: string; error?: string } | null;
      if (!completed.ok || completedBody?.uploadId !== payload.uploadId) {
        throw new Error(completedBody?.error || "Profile photo validation failed.");
      }

      const { data: avatarKey, error: avatarErrorResult } = await supabase.rpc("set_profile_avatar_secure", {
        p_upload_id: payload.uploadId,
      });
      if (avatarErrorResult || typeof avatarKey !== "string") {
        throw new Error(avatarErrorResult?.message || "Could not save profile photo.");
      }
      setProfile((current) => ({ ...current, avatar_key: avatarKey, avatar_upload_id: payload.uploadId ?? null }));
      setMessage("Profile photo updated.");
      window.dispatchEvent(new Event("rglrs:profile-updated"));
      router.refresh();
    } catch (uploadError) {
      setAvatarError(uploadError instanceof Error ? uploadError.message : "Could not update profile photo.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarError("");
    const { error: avatarErrorResult } = await supabase.rpc("set_profile_avatar_secure", { p_upload_id: null });
    setAvatarBusy(false);
    if (avatarErrorResult) {
      setAvatarError(avatarErrorResult.message || "Could not remove profile photo.");
      return;
    }
    setProfile((current) => ({ ...current, avatar_key: null, avatar_upload_id: null }));
    setMessage("Profile photo removed.");
    window.dispatchEvent(new Event("rglrs:profile-updated"));
    router.refresh();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const displayName = draft.display_name.trim();
    const username = draft.username.trim().toLowerCase();
    const bio = draft.bio.trim();
    if (!displayName) {
      setError("Add a display name.");
      return;
    }
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      setError("Username must be 3–30 characters using lowercase letters, numbers, or underscores.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setIsSaving(true);
    const { error: updateError } = await supabase.rpc("update_profile_secure", {
      p_display_name: displayName,
      p_username: username,
      p_bio: bio,
    });
    setIsSaving(false);
    if (updateError) {
      setError(updateError.code === "23505" ? "That username is already taken." : updateError.message);
      return;
    }
    setProfile((current) => ({ ...current, display_name: displayName, username, bio }));
    setIsEditing(false);
    setMessage("Profile saved.");
    window.dispatchEvent(new Event("rglrs:profile-updated"));
    router.refresh();
  }

  return <>
    <div className="profile-top">
      <div className="avatar-ring" style={{position:"relative"}}>
        {profile.avatar_key?.startsWith("http") || profile.avatar_key?.startsWith("/private-media/") ? (
          <img className="profile-avatar-image" src={profile.avatar_key} alt={`${profile.display_name} profile`} />
        ) : (
          <div className="profile-avatar-fallback" aria-label={`${profile.display_name} avatar`}>{avatarInitials}</div>
        )}
        <span className="online-dot"/>
      </div>
      <div className="profile-name">{profile.display_name}</div>
      {profile.is_founder ? <div className="founder-badge"><BadgeCheck size={14} /> Founder</div> : null}
      <div className="profile-handle">@{profile.username}</div>
      <div className="profile-bio">{profile.bio || "Tell your regulars a little about you."}</div>
      <div className="profile-photo-actions">
        <label className="secondary-btn profile-photo-button">
          <Camera size={14} />
          {avatarBusy ? "Uploading…" : profile.avatar_key ? "Change photo" : "Add profile photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} disabled={avatarBusy} />
        </label>
        {profile.avatar_key ? <button className="text-btn" type="button" onClick={removeAvatar} disabled={avatarBusy}>Remove</button> : null}
      </div>
      {avatarError ? <p className="form-message error-message" role="alert">{avatarError}</p> : null}
      <div className="profile-stats">
        <div className="profile-stat"><strong>0</strong><span>Posts</span></div>
        <div className="profile-stat"><strong>0</strong><span>Events</span></div>
        <div className="profile-stat"><strong>0</strong><span>Friends</span></div>
      </div>
      <button className="secondary-btn" type="button" onClick={beginEditing} style={{marginTop:14}}>Edit profile</button>
    </div>

    {message ? <p className="form-message success-message" role="status" style={{textAlign:"center"}}>{message}</p> : null}

    {isEditing ? <form className="profile-editor" onSubmit={saveProfile}>
      <label htmlFor="profile-display-name">Display name
        <input id="profile-display-name" className="input" value={draft.display_name} onChange={(event) => setDraft({...draft, display_name:event.target.value})} maxLength={80} required/>
      </label>
      <label htmlFor="profile-username">Username
        <input id="profile-username" className="input" value={draft.username} onChange={(event) => setDraft({...draft, username:event.target.value.toLowerCase()})} pattern="[a-z0-9_]{3,30}" maxLength={30} required/>
      </label>
       <label htmlFor="profile-bio">Bio <span className="profile-field-hint">shown under your profile photo</span>
         <textarea id="profile-bio" className="input" value={draft.bio} onChange={(event) => setDraft({...draft, bio:event.target.value})} maxLength={240} rows={3} placeholder="A short intro about you"/>
      </label>
      <div className="row gap8">
        <button className="primary-btn" type="submit" disabled={isSaving}>{isSaving ? "Saving…" : "Save changes"}</button>
        <button className="secondary-btn" type="button" onClick={cancelEditing} disabled={isSaving}>Cancel</button>
      </div>
      {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
    </form> : null}

    <div className="profile-tabs"><span className="profile-tab active">Posts</span><span className="profile-tab">Events</span><span className="profile-tab">Tagged</span></div>
    <div className="empty-state" style={{padding:"42px 18px",textAlign:"center"}}>
      <div className="section-title">Nothing here yet</div>
      <p className="muted" style={{fontSize:9,lineHeight:1.5}}>When you share something with your regulars, it will show up on your profile.</p>
      <span className="muted-2" style={{fontSize:8}}>{email}</span>
    </div>
  </>;
}