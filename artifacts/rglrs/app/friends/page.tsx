import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FriendsClient } from "./friends-client";

export default async function FriendsPage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: friendships, error } = await supabase.rpc("list_friendships_secure");

  return (
    <PageShell>
      <MobileHeader title="Friends" backHref="/search" />
      <div className="page-header">
        <h1>Friends</h1>
        <p>Manage your connections and pending requests.</p>
      </div>
      {error
        ? <div className="empty-state card"><strong>Friends could not be loaded</strong><span>Please try again in a moment.</span></div>
        : <FriendsClient initialFriendships={friendships || []} />}
    </PageShell>
  );
}
