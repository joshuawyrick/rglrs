"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { QrDownloads } from "@/components/qr-downloads";
import { getAppUrl } from "@/lib/app-url";

type Invite = { id: string; label: string | null; expires_at: string; max_uses: number | null; use_count: number; revoked_at: string | null };

function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function SignupInviteManager() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = path ? getAppUrl(path) : null;

  async function load() {
    const response = await fetch("/signup-invites", { cache: "no-store" });
    const body = await response.json();
    if (response.ok) setInvites(body.invites);
    else setError(body.error || "Could not load invitations.");
  }
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/signup-invites", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: String(form.get("label") || "") || null, expiresAt: new Date(String(form.get("expires"))).toISOString(), maxUses: form.get("maxUses") ? Number(form.get("maxUses")) : null }),
    });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error || "Could not create invitation.");
    setPath(body.path); await load();
  }

  async function revoke(inviteId: string) {
    setBusy(true); setError(null);
    const response = await fetch("/signup-invites", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ inviteId }) });
    const body = await response.json(); setBusy(false);
    if (!response.ok) return setError(body.error || "Could not revoke invitation.");
    await load();
  }

  async function share() {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ title: "Join me on RGLRS", text: "I’d like you to join my private network on RGLRS.", url });
      else await navigator.clipboard.writeText(url);
      setCopied(true); window.setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <div className="stack gap16">
      <form className="card card-pad stack gap12" onSubmit={create}>
        <label>
          <span className="form-label">Private label <em>optional</em></span>
          <input className="input" name="label" maxLength={80} placeholder="Family, running club…" />
        </label>
        <div className="form-two">
          <label>
            <span className="form-label">Expires</span>
            <input className="input" type="datetime-local" name="expires" required min={localDateTime(new Date(Date.now() + 60000))} max={localDateTime(new Date(Date.now() + 365 * 86400000))} defaultValue={localDateTime(new Date(Date.now() + 7 * 86400000))} />
          </label>
          <label>
            <span className="form-label">Max uses <em>optional</em></span>
            <input className="input" type="number" name="maxUses" min="1" max="10000" placeholder="Unlimited" />
          </label>
        </div>
        <button className="primary-btn" disabled={busy} style={{ marginTop: 4 }}>
          {busy ? "Creating…" : "Create invitation"}
        </button>
      </form>
      
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      
      {url && path ? (
        <section className="card card-pad invite-print-card">
          <h2>Invite someone to RGLRS</h2>
          <p>Scan the QR code or share the private link. Save it now—the token is not stored and cannot be shown again.</p>
          <QrDownloads value={url} fileName="rglrs-invitation" />
          <div className="stack gap8" style={{ width: "100%", marginTop: 8 }}>
            <button className="secondary-btn" onClick={share}>
              {copied ? <><Check size={18} /> Link copied</> : <><Share2 size={18} /> Share invitation</>}
            </button>
            <a className="text-btn" href={path}>Preview invitation</a>
          </div>
        </section>
      ) : null}
      
      <section className="stack gap8">
        <h2 className="settings-title" style={{ marginTop: 16 }}>Invitation history</h2>
        {invites.length ? invites.map((invite) => (
          <div className="card card-pad row space" key={invite.id}>
            <div>
              <div className="friend-name" style={{ fontSize: 13, marginBottom: 4 }}>{invite.label || "RGLRS invitation"}</div>
              <div className="friend-sub" style={{ fontSize: 10.5 }}>
                {invite.use_count}{invite.max_uses ? ` / ${invite.max_uses}` : ""} uses · expires {new Date(invite.expires_at).toLocaleDateString()}
              </div>
            </div>
            {invite.revoked_at ? (
              <span className="pill">Revoked</span>
            ) : (
              <button className="text-btn" disabled={busy} onClick={() => revoke(invite.id)}>Revoke</button>
            )}
          </div>
        )) : (
          <div className="empty-state">
            <span>No invitations yet.</span>
          </div>
        )}
      </section>
    </div>
  );
}
