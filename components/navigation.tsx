"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, Home, MessageCircle, Plus, Search, Settings, UserRound, UsersRound } from "lucide-react";
import { Brand } from "@/components/brand";
import { people } from "@/lib/demo-data";

const desktopMain = [
  ["/", "Home", Home],
  ["/events", "Events", CalendarDays],
  ["/messages", "Messages", MessageCircle],
  ["/notifications", "Activity", Bell],
  ["/profile", "Profile", UserRound]
] as const;

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function DesktopNav() {
  const path = usePathname();
  return (
    <aside className="left-rail app-side">
      <nav className="desktop-nav glass">
        <Link href="/"><Brand /></Link>
        {desktopMain.map(([href,label,Icon]) => (
          <Link key={href} href={href} className={`nav-link ${isActive(path,href)?"active":""}`}>
            <Icon size={18}/><span>{label}</span>
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
          <img className="avatar" src={people.josh.avatar} width={33} height={33} alt=""/>
          <div><div className="friend-name">Josh Wyrick</div><div className="friend-sub">@joshwyrick</div></div>
        </div>
      </nav>
    </aside>
  );
}

export function HomeMobileTop() {
  return (
    <div className="home-mobile-top">
      <Brand compact/>
      <div className="row gap8">
        <Link className="screen-icon-btn" href="/notifications" aria-label="Notifications"><Bell size={18}/></Link>
        <Link href="/profile" aria-label="Profile"><img className="avatar" src={people.josh.avatar} width={28} height={28} alt=""/></Link>
      </div>
    </div>
  );
}

export function MobileBottom() {
  const path = usePathname();
  const links = [
    ["/", Home],
    ["/search", Search],
    ["/create", Plus],
    ["/messages", MessageCircle],
    ["/profile", UserRound]
  ] as const;
  return (
    <div className="mobile-bottom">
      <div className="mobile-bottom-inner">
        {links.map(([href,Icon],i) => (
          <Link key={href} href={href} aria-label={href} className={i===2?"mobile-create":`mobile-nav-link ${isActive(path,href)?"active":""}`}>
            <Icon size={i===2?18:19}/>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function RightRail() {
  return (
    <aside className="right-rail app-side">
      <div className="side-panel glass">
        <div className="row space"><h3>Your regulars</h3><UsersRound size={15} color="var(--teal)"/></div>
        {[people.mike,people.sarah,people.jess,people.taylor].map((p,i) => (
          <div className="friend-row row gap10" key={p.name}>
            <img className="avatar" src={p.avatar} width={33} height={33} alt=""/>
            <div style={{flex:1}}><div className="friend-name">{p.name}</div><div className="friend-sub">{i%2?"Shared 3 events":"In your close circle"}</div></div>
            <MessageCircle size={14} color="var(--muted)"/>
          </div>
        ))}
        <div style={{height:1,background:"var(--line)",margin:"12px 0"}}/>
        <div className="eyebrow">Private by design</div>
        <p style={{fontSize:9,color:"var(--muted)",lineHeight:1.6,marginBottom:0}}>No public follower race. No stranger feed. Every post has an audience.</p>
      </div>
    </aside>
  );
}

export function AppShell({children,homeHeader=false}:{children:React.ReactNode;homeHeader?:boolean}) {
  return (
    <div className="app-layout">
      <DesktopNav/>
      <main className="app-main">{homeHeader?<HomeMobileTop/>:null}{children}</main>
      <RightRail/>
      <MobileBottom/>
    </div>
  );
}
