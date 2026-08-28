"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Friendship = { id: string; requester_id: string; addressee_id: string; status: string } | null;

export function FriendshipControl({ memberId, currentUserId, initial }: { memberId: string; currentUserId: string; initial: Friendship }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [optimistic, setOptimistic] = useState<Friendship>(initial);

  useEffect(() => {
    setOptimistic(initial);
  }, [initial]);

  async function rpc(name: string, args: Record<string, string>) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Friend controls are unavailable.");
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(name, args);
    setBusy(false);

    if (rpcError || data === false || data === null) {
      return setError("Could not update this friendship. Please try again.");
    }

    window.dispatchEvent(new CustomEvent("rglrs:friendship-changed"));
    window.localStorage.setItem("rglrs:friendship-changed", Date.now().toString());
    router.refresh();
  }

  const current = optimistic;

  return (
    <section className="card card-pad" style={{ marginBottom: 12 }}>
      <div className="section-title">Connection</div>
      {!current ? (
        <button className="primary-btn" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => rpc("create_friend_request_secure", { p_addressee: memberId })}>Add friend</button>
      ) : null}

      {current?.status === "pending" && current.addressee_id === currentUserId ? (
        <div className="row gap8" style={{ marginTop: 8 }}>
          <button className="primary-btn" style={{ flex: 1 }} disabled={busy} onClick={() => rpc("respond_friend_request_secure", { p_friendship: current.id, p_response: "accepted" })}>Accept</button>
          <button className="secondary-btn" style={{ flex: 1 }} disabled={busy} onClick={() => rpc("respond_friend_request_secure", { p_friendship: current.id, p_response: "declined" })}>Decline</button>
        </div>
      ) : null}

      {current?.status === "pending" && current.requester_id === currentUserId ? (
        <div className="friend-sub" style={{ marginTop: 8 }}>Friend request sent</div>
      ) : null}

      {current?.status === "accepted" ? (
        confirmRemove ? (
          <div className="stack gap8" style={{ marginTop: 8 }}>
            <div className="friend-sub" style={{ color: "var(--danger)" }}>Are you sure you want to remove this friend?</div>
            <div className="row gap8">
              <button className="primary-btn" style={{ flex: 1, background: "var(--danger)", color: "#fff" }} disabled={busy} onClick={() => rpc("remove_friendship_secure", { p_friendship: current.id })}>Confirm</button>
              <button className="secondary-btn" style={{ flex: 1 }} disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="secondary-btn" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => setConfirmRemove(true)}>Remove friend</button>
        )
      ) : null}

      {current?.status === "declined" ? (
        <button className="primary-btn" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => rpc("create_friend_request_secure", { p_addressee: memberId })}>Send a new friend request</button>
      ) : null}

      {error ? <div className="form-error" role="alert">{error}</div> : null}
    </section>
  );
}
