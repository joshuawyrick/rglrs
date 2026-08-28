"use client";

import { useEffect, useState } from "react";
import { Bookmark, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const items=[
  ["Account","Manage your account","/settings/account"],["Invite People","Create and manage private invitations","/join/manage"],["Privacy","Control who sees what","/settings/privacy"],["Notifications","Manage your alerts","/notifications"],["Security","Password and sessions","/settings/security"],["Blocked Users","People you've blocked","/settings/blocked"],["Data & Storage","Your data and media","/settings/data"],["Help & Support","Get help",null]
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = useState("Your profile");
  const [username, setUsername] = useState("");
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !active) return;
       const { data: profile } = await supabase.from("profiles").select("display_name, username, avatar_key").eq("id", user.id).maybeSingle();
      if (active && profile) {
        setName(profile.display_name);
        setUsername(profile.username);
         setAvatarKey(profile.avatar_key);
      }
    });
    return () => { active = false; };
  }, []);

  async function logout() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setIsLoggingOut(true);
    setLogoutError("");
    const { error } = await supabase.auth.signOut();
    if (error) {
      setLogoutError(error.message);
      setIsLoggingOut(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return <PageShell>
    <MobileHeader title="Settings" backHref="/profile"/>
    <div className="settings-profile row gap10">
       {avatarKey?.startsWith("http") || avatarKey?.startsWith("/private-media/") ? <img className="profile-avatar-small" src={avatarKey} alt="" style={{width:43,height:43}} /> : <div className="profile-avatar-fallback" style={{width:43,height:43,fontSize:14}}>{name.slice(0,1).toUpperCase()}</div>}
      <div style={{flex:1}}><div className="friend-name">{name}</div><div className="friend-sub">{username ? `@${username} · Profile shortcut unavailable` : "Profile shortcut unavailable"}</div></div>
    </div>
    <Link className="settings-row" href="/saved" data-testid="link-settings-saved">
      <div><div className="settings-title">Saved</div><div className="settings-sub">Revisit posts you bookmarked</div></div>
      <Bookmark size={16} color="var(--teal)"/>
    </Link>
    {items.map(([title,sub,href])=> href ? <Link className="settings-row" href={href} key={title}><div><div className="settings-title">{title}</div><div className="settings-sub">{sub}</div></div><ChevronRight size={16} color="var(--muted-2)"/></Link> : <div className="settings-row" key={title}><div><div className="settings-title">{title}</div><div className="settings-sub">{sub} · Unavailable</div></div><span className="settings-sub">Soon</span></div>)}
    {logoutError ? <p className="form-message error-message" role="alert">{logoutError}</p> : null}
    <button className="danger-btn" type="button" onClick={logout} disabled={isLoggingOut}>{isLoggingOut ? "Logging out…" : "Log Out"}</button>
  </PageShell>;
}