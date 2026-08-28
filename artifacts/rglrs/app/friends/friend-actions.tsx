"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function FriendListActions({ friendshipId, type }: { friendshipId: string; type: "incoming" | "outgoing" | "accepted" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmRemove, setConfirmRemove] = useState(false);

  async function rpc(name: string, args: Record<string, string>) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Friend controls are unavailable.");
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(name, args);
    setBusy(false);
    if (rpcError || data === false || data === null) return setError("Could not update this friendship. Please try again.");
    setConfirmRemove(false);
    window.dispatchEvent(new CustomEvent("rglrs:friendship-changed"));
    window.localStorage.setItem("rglrs:friendship-changed", Date.now().toString());
    router.refresh();
  }

  if (type === "incoming") {
    return (
      <div className="row gap6" style={{ marginTop: 8 }}>
        <button className="primary-btn" style={{ padding: "6px 12px", fontSize: "10px", minHeight: "30px", flex: 1 }} disabled={busy} onClick={() => rpc("respond_friend_request_secure", { p_friendship: friendshipId, p_response: "accepted" })}>{busy ? "Updating…" : "Accept"}</button>
        <button className="secondary-btn" style={{ padding: "6px 12px", fontSize: "10px", minHeight: "30px", flex: 1 }} disabled={busy} onClick={() => rpc("respond_friend_request_secure", { p_friendship: friendshipId, p_response: "declined" })}>Decline</button>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>
    );
  }

  if (type === "outgoing") {
    return (
      <div style={{ marginTop: 8, display: "flex" }}>
        <div className="pill">Request sent</div>
      </div>
    );
  }

  if (type === "accepted") {
    return (
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column" }}>
        {confirmRemove ? (
          <div className="stack gap8">
            <div className="friend-sub" style={{ color: "var(--danger)" }}>Are you sure you want to remove this friend?</div>
            <div className="row gap6">
              <button className="primary-btn" style={{ padding: "6px 12px", fontSize: "10px", minHeight: "30px", flex: 1, background: "var(--danger)", color: "#fff" }} disabled={busy} onClick={() => rpc("remove_friendship_secure", { p_friendship: friendshipId })}>Confirm</button>
              <button className="secondary-btn" style={{ padding: "6px 12px", fontSize: "10px", minHeight: "30px", flex: 1 }} disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="secondary-btn" style={{ padding: "6px 12px", fontSize: "10px", minHeight: "30px", width: "100%" }} disabled={busy} onClick={() => setConfirmRemove(true)}>Remove friend</button>
        )}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>
    );
  }

  return null;
}
