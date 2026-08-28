import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { MemberSafetyPanel } from "@/components/member-safety-panel";
import { FriendshipControl } from "@/components/friendship-control";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id,display_name,username,bio,avatar_key,is_founder").eq("id", id).maybeSingle();
  if (!profile) notFound();
  const isSelf = profile.id === user.id;
  const [{ data: friendship }, { data: connections }] = await Promise.all([
    isSelf ? Promise.resolve({ data: null }) : supabase.from("friendships").select("id,requester_id,addressee_id,status").or(`and(requester_id.eq.${user.id},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${user.id})`).maybeSingle(),
    supabase.rpc("list_profile_connections_secure", { p_profile: profile.id }),
  ]);

  return <PageShell>
    <MobileHeader title={isSelf ? "Your profile" : "Member"} backHref="/search" />
    <section className="profile-top">
      {profile.avatar_key?.startsWith("http") || profile.avatar_key?.startsWith("/private-media/") ? <img className="profile-avatar-image" src={profile.avatar_key} alt={`${profile.display_name} profile`} style={{margin:"0 auto 10px"}} /> : <div className="profile-avatar-fallback" style={{ margin: "0 auto 10px" }}>{profile.display_name.slice(0, 1).toUpperCase()}</div>}
      <div className="profile-name">{profile.display_name}</div>
      {profile.is_founder ? <div className="founder-badge"><span aria-hidden="true">✦</span> Founder</div> : null}
      <div className="profile-handle">@{profile.username}</div>
      {profile.bio ? <p className="profile-bio">{profile.bio}</p> : null}
    </section>
    {!isSelf ? <><FriendshipControl memberId={profile.id} currentUserId={user.id} initial={friendship}/><MemberSafetyPanel memberId={profile.id} memberName={profile.display_name} /></> : null}
    <section className="card card-pad" style={{marginTop:12}}>
      <div className="settings-title">Connections · {(connections || []).length}</div>
      <div className="stack gap8" style={{marginTop:8}}>{(connections || []).slice(0,12).map((connection: {id:string;display_name:string;username:string;avatar_key:string|null}) =>
        <a className="row gap10" href={`/people/${connection.id}`} key={connection.id}>
          {connection.avatar_key ? <img className="profile-avatar-small" src={connection.avatar_key} alt=""/> : <span className="profile-avatar-fallback profile-avatar-small">{connection.display_name.slice(0,1)}</span>}
          <span><strong>{connection.display_name}</strong><small style={{display:"block"}}>@{connection.username}</small></span>
        </a>)}
        {!connections?.length ? <span className="form-hint">Connections are private or none are visible.</span> : null}
      </div>
    </section>
  </PageShell>;
}