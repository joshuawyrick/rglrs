"use client";

import Link from "next/link";
import { Check, UserPlus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Preview = { inviter: { id: string; name: string; username: string | null }; label: string | null };

export function SignupInviteRedemption({ token }: { token: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [friendSent, setFriendSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continuation = `/join/${token}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch(`/signup-invites/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await response.json();
      if (!active) return;
      if (response.ok) setPreview(body);
      else setError(body.error || "This invitation is unavailable.");
      setLoading(false);
    })();
    return () => { active = false; };
  }, [token]);

  async function redeem() {
    setBusy(true); setError(null);
    const response = await fetch(`/signup-invites/${encodeURIComponent(token)}/redeem`, { method: "POST" });
    const body = await response.json();
    setBusy(false);
    if (response.status === 401) return router.push(`/login?next=${encodeURIComponent(continuation)}`);
    if (!response.ok) return setError(body.error || "Could not accept this invitation.");
    setAccepted(true);
  }

  async function addInviter() {
    if (!preview) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Friend controls are unavailable.");
    setBusy(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_friend_request_secure", { p_addressee: preview.inviter.id });
    setBusy(false);
    if (rpcError || !data) return setError("Could not send the friend request.");
    setFriendSent(true);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card glass">
        <div className="row space" style={{ marginBottom: 16 }}>
          <Link href="/" className="screen-icon-btn"><X size={20} /></Link>
          <span style={{ fontSize: 13, fontWeight: 800 }}>RGLRS Invite</span>
          <span style={{ width: 40 }} />
        </div>
        
        {loading ? (
          <div className="feed-loader" aria-label="Loading invitation"><span /></div>
        ) : !preview ? (
          <div className="empty-state">
            <strong>Invitation unavailable</strong>
            <span>{error}</span>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ display: "grid", placeItems: "center" }}><BrandMark size={72} /></div>
            <h1>{accepted ? "You’re in." : `${preview.inviter.name} invited you`}</h1>
            <p>{accepted ? "Welcome to RGLRS, a private place for your real-life people." : "Join their private network on RGLRS."}</p>
            
            {preview.label && !accepted ? (
              <div className="card card-pad" style={{ marginTop: 24, fontSize: 12, fontWeight: 700 }}>
                {preview.label}
              </div>
            ) : null}
            
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            
            {!accepted ? (
              <>
                <button className="primary-btn" style={{ width: "100%", marginTop: 24 }} disabled={busy} onClick={redeem}>
                  {busy ? "Accepting…" : "Accept invitation"}
                </button>
                <div className="form-two" style={{ marginTop: 12 }}>
                  <Link className="secondary-btn" href={`/login?next=${encodeURIComponent(continuation)}`}>Sign in</Link>
                  <Link className="secondary-btn" href={`/signup?next=${encodeURIComponent(continuation)}`}>Create account</Link>
                </div>
              </>
            ) : (
              <>
                <button className="secondary-btn" style={{ width: "100%", marginTop: 24 }} disabled={busy || friendSent} onClick={addInviter}>
                  {friendSent ? <><Check size={18} /> Friend request sent</> : <><UserPlus size={18} /> Add {preview.inviter.name}</>}
                </button>
                <Link href="/" className="primary-btn" style={{ width: "100%", marginTop: 12 }}>Continue to RGLRS</Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
