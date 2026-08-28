import { redirect } from "next/navigation";
import { Bookmark, Settings } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/page-shell";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ProfileEditor, type ProfileRecord } from "@/components/profile-editor";
import { CircleManager } from "@/components/circle-manager";

export default async function ProfilePage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, avatar_key, avatar_upload_id, is_founder")
    .eq("id", user.id)
    .maybeSingle();

  const initialProfile: ProfileRecord = profile ?? {
    id: user.id,
    username: user.user_metadata?.username || `user_${user.id.replaceAll("-", "").slice(0, 25)}`,
    display_name: user.user_metadata?.full_name || "New RGLR",
    bio: "",
    avatar_key: null,
    avatar_upload_id: null,
    is_founder: false,
  };
  const [{ data: circles }, { data: friendships }] = await Promise.all([
    supabase.from("circles").select("id,name,emoji").eq("owner_id", user.id).order("name"),
    supabase.from("friendships").select("requester_id,addressee_id").eq("status", "accepted").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
  ]);
  const friendIds = (friendships || []).map((friend) => friend.requester_id === user.id ? friend.addressee_id : friend.requester_id);
  const [{ data: friendProfiles }, { data: circleMembers }] = await Promise.all([
    friendIds.length ? supabase.from("profiles").select("id,display_name").in("id", friendIds) : Promise.resolve({ data: [] }),
    circles?.length ? supabase.from("circle_members").select("circle_id,user_id").in("circle_id", circles.map((circle) => circle.id)) : Promise.resolve({ data: [] }),
  ]);

  return <PageShell>
    <div className="row space" style={{minHeight:48}}>
      <Link className="screen-icon-btn" href="/saved" aria-label="Saved posts" data-testid="link-profile-saved"><Bookmark size={17}/></Link>
      <Link className="screen-icon-btn" href="/settings" aria-label="Settings" data-testid="link-profile-settings"><Settings size={17}/></Link>
    </div>
    <ProfileEditor initialProfile={initialProfile} email={user.email ?? ""}/>
    <CircleManager initialCircles={(circles || []).map((circle) => ({...circle, members:(circleMembers || []).filter((member) => member.circle_id === circle.id).map((member) => member.user_id)}))} friends={(friendProfiles || []).map((friend) => ({id:friend.id,name:friend.display_name}))}/>
  </PageShell>;
}