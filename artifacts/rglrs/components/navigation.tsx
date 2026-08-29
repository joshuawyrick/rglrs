"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell, CalendarDays, Home, MapPin, MessageCircle, Plus, Search, Settings, UserRound, UsersRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { NavBadge, UnreadProvider, useUnread } from "@/components/unread-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type ProfileSummary = {
  display_name: string;
  username: string;
  avatar_key: string | null;
};

const desktopMain = [
  ["/", "Home", Home],
  ["/whats-crackin", "What’s Crackin", MapPin],
  ["/events", "Events", CalendarDays],
  ["/messages", "Messages", MessageCircle],
  ["/notifications", "Activity", Bell],
  ["/profile", "Profile", UserRound]
] as const;

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function DesktopNav({ profile }: { profile: ProfileSummary | null }) {
  const path = usePathname();
  const unread = useUnread();
  const avatarText = profile?.display_name.trim().slice(0, 1).toUpperCase() || "R";
  const avatarUrl = profile?.avatar_key?.startsWith("http") || profile?.avatar_key?.startsWith("/private-media/") ? profile.avatar_key : null;
  return (
    <aside className="left-rail app-side">
      <nav className="desktop-nav glass">
        <Link href="/"><Brand /></Link>
        {desktopMain.map(([href,label,Icon]) => (
          <Link key={href} href={href} className={`nav-link ${isActive(path,href)?"active":""}`}>
            <Icon size={18}/><span>{label}</span>
            <NavBadge count={href === "/messages" ? unread.messages : href === "/notifications" ? unread.notifications : 0}/>
          </Link>
        ))}
        <Link href="/create" className="nav-link" style={{marginTop:8,background:"var(--teal)",color:"#061211"}}>
          <Plus size={18}/><span>Create</span>
        </Link>
        <div className="nav-spacer"/>
        <Link href="/settings" className={`nav-link ${isActive(path,"/settings")?"active":""}`}>
          <Settings size={18}/><span>Settings</span>
        </Link>
        <div className="nav-profile row gap10">
          {avatarUrl ? <img className="profile-avatar-small" src={avatarUrl} alt="" /> : <div className="profile-avatar-fallback" style={{width:33,height:33,fontSize:11}}>{avatarText}</div>}
          <div><div className="friend-name">{profile?.display_name || "Your profile"}</div><div className="friend-sub">{profile ? `@${profile.username}` : "Private account"}</div></div>
        </div>
      </nav>
    </aside>
  );
}

export function HomeMobileTop({ profile }: { profile: ProfileSummary | null }) {
  const avatarText = profile?.display_name.trim().slice(0, 1).toUpperCase() || "R";
  const avatarUrl = profile?.avatar_key?.startsWith("http") || profile?.avatar_key?.startsWith("/private-media/") ? profile.avatar_key : null;
  const { notifications } = useUnread();
  return (
    <div className="home-mobile-top">
      <Brand compact/>
      <div className="row gap8">
        <Link className="screen-icon-btn" href="/whats-crackin" aria-label="What’s Crackin"><MapPin size={18}/></Link>
        <Link className="screen-icon-btn badge-anchor" href="/notifications" aria-label="Notifications"><Bell size={18}/><NavBadge count={notifications}/></Link>
        <Link href="/profile" aria-label="Profile">{avatarUrl ? <img className="profile-avatar-small" src={avatarUrl} alt="" style={{width:28,height:28}} /> : <div className="profile-avatar-fallback" style={{width:28,height:28,fontSize:10}}>{avatarText}</div>}</Link>
      </div>
    </div>
  );
}

export function MobileBottom() {
  const path = usePathname();
  const { messages } = useUnread();
  const links = [
    ["/", Home],
    ["/whats-crackin", MapPin],
    ["/search", Search],
    ["/create", Plus],
    ["/messages", MessageCircle],
    ["/profile", UserRound]
  ] as const;
  return (
    <div className="mobile-bottom">
      <div className="mobile-bottom-inner" style={{gridTemplateColumns:"repeat(6,1fr)"}}>
        {links.map(([href,Icon]) => (
          <Link
            key={href}
            href={href}
            aria-label={href}
            className={href==="/create"?"mobile-create":`mobile-nav-link ${isActive(path,href)?"active":""}`}
            style={href==="/create"?{width:44,height:44}:{minHeight:44}}
          >
            <Icon size={href==="/create"?18:19}/>{href === "/messages" ? <NavBadge count={messages}/> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function RightRail() {
  return (
    <aside className="right-rail app-side">
      <div className="side-panel glass stack gap16">
        <div>
          <div className="row space"><h3>Your private circle</h3><UsersRound size={15} color="var(--teal)"/></div>
          <div className="eyebrow">Private by design</div>
          <p style={{fontSize:9,color:"var(--muted)",lineHeight:1.6,marginBottom:12}}>Messages and activity are visible only to authorized members. No public follower race. Every post has an audience.</p>
          <Link href="/friends" className="secondary-btn" style={{ width: "100%" }}>Manage friends</Link>
        </div>
      </div>
    </aside>
  );
}

export function AppShell({children,homeHeader=false}:{children:React.ReactNode;homeHeader?:boolean}) {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const loadProfile = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from("profiles").select("display_name, username, avatar_key").eq("id", user.id).maybeSingle();
    setProfile(data);
  }, []);

  useEffect(() => {
    void loadProfile();
    const refreshProfile = () => { void loadProfile(); };
    window.addEventListener("rglrs:profile-updated", refreshProfile);
    return () => window.removeEventListener("rglrs:profile-updated", refreshProfile);
  }, [loadProfile]);

  return (
    <UnreadProvider>
      <div className="app-layout">
        <DesktopNav profile={profile}/>
        <main className="app-main">{homeHeader?<HomeMobileTop profile={profile}/>:null}{children}</main>
        <RightRail/>
        <MobileBottom/>
      </div>
    </UnreadProvider>
  );
}
