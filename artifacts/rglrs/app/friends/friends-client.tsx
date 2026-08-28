"use client";

import Link from "next/link";
import { Search, UserRound } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FriendListActions } from "./friend-actions";

type Friendship = {
  friendship_id: string;
  status: "accepted" | "pending";
  direction: "friend" | "incoming" | "outgoing";
  profile_id: string;
  display_name: string;
  username: string;
  avatar_key: string | null;
};

export function FriendsClient({ initialFriendships }: { initialFriendships: Friendship[] }) {
  const router = useRouter();
  
  useEffect(() => {
    const refresh = () => router.refresh();
    window.addEventListener("rglrs:friendship-changed", refresh);
    return () => window.removeEventListener("rglrs:friendship-changed", refresh);
  }, [router]);

  const requests = initialFriendships.filter((friendship) => friendship.direction === "incoming");
  const friends = initialFriendships.filter((friendship) => friendship.direction === "friend");
  const outgoing = initialFriendships.filter((friendship) => friendship.direction === "outgoing");

  const personRow = (friendship: Friendship, type: "incoming" | "outgoing" | "accepted") => (
    <div className="card card-pad" key={friendship.friendship_id}>
      <Link href={`/people/${friendship.profile_id}`} className="row gap12">
        {friendship.avatar_key?.startsWith("http") || friendship.avatar_key?.startsWith("/private-media/") ? (
          <img src={friendship.avatar_key} alt="" className="profile-avatar-small" style={{ width: 42, height: 42 }} />
        ) : (
          <div className="profile-avatar-fallback" style={{ width: 42, height: 42, fontSize: 16 }}>
            {friendship.display_name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div style={{minWidth:0}}>
          <div className="friend-name">{friendship.display_name}</div>
          <div className="friend-sub">@{friendship.username}</div>
        </div>
      </Link>
      <FriendListActions friendshipId={friendship.friendship_id} type={type} />
    </div>
  );

  return (
    <div className="stack gap16">
      <Link href="/search" className="primary-btn" style={{width:"100%"}}><Search size={15}/>Find friends</Link>
      {requests.length > 0 && (
        <section>
          <h2 className="search-section-title">Incoming requests</h2>
          <div className="stack gap8">{requests.map((friendship) => personRow(friendship, "incoming"))}</div>
        </section>
      )}

      <section>
        <h2 className="search-section-title">Current friends</h2>
        {friends.length === 0 ? (
          <div className="empty-state">
            <UserRound size={32} color="var(--muted)" />
            <strong>No friends yet</strong>
            <span>Search for people to build your private circle.</span>
          </div>
        ) : (
          <div className="stack gap8">{friends.map((friendship) => personRow(friendship, "accepted"))}</div>
        )}
      </section>
      {outgoing.length > 0 ? (
        <section>
          <h2 className="search-section-title">Sent requests</h2>
          <div className="stack gap8">{outgoing.map((friendship) => personRow(friendship, "outgoing"))}</div>
        </section>
      ) : null}
    </div>
  );
}
