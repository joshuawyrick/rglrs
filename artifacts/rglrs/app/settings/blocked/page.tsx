"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type BlockedMember = { user_id: string; display_name: string; username: string; blocked_at: string };

export default function BlockedMembersPage() {
  const [members, setMembers] = useState<BlockedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError("Blocked members are unavailable until Supabase is connected."); setLoading(false); return; }
    void supabase.rpc("list_blocked_members").then(({ data, error: listError }) => {
      if (listError) setError(listError.message || "Could not load blocked members.");
      else setMembers((data || []) as BlockedMember[]);
      setLoading(false);
    });
  }, []);

  async function unblock(member: BlockedMember) {
    if (!window.confirm(`Unblock ${member.display_name}?`)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return setError("Blocked members are unavailable until Supabase is connected.");
    setWorkingId(member.user_id); setError(null);
    const { error: unblockError } = await supabase.rpc("unblock_member", { p_blocked: member.user_id });
    if (unblockError) setError(unblockError.message || "Could not unblock this member.");
    else setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
    setWorkingId(null);
  }

  return <PageShell>
    <MobileHeader title="Blocked Users" backHref="/settings" />
    <div className="page-header"><h1>Blocked Users</h1><p>Blocked members cannot interact with you or see your eligible content.</p></div>
    {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
    {loading ? <div className="feed-loader" aria-label="Loading blocked members"><span /></div> : null}
    {!loading && !members.length && !error ? <div className="empty-state"><strong>No blocked members</strong><span>You have not blocked anyone.</span></div> : null}
    {members.map((member) => <div className="blocked-member-row" key={member.user_id}>
      <div className="profile-avatar-fallback blocked-member-avatar">{member.display_name.slice(0, 1).toUpperCase()}</div>
      <div><div className="friend-name">{member.display_name}</div><div className="friend-sub">@{member.username}</div></div>
      <button className="secondary-btn" type="button" onClick={() => unblock(member)} disabled={workingId === member.user_id}>{workingId === member.user_id ? "Unblocking…" : "Unblock"}</button>
    </div>)}
  </PageShell>;
}