import { ChevronRight } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { people } from "@/lib/demo-data";

const items=[
  ["Account","Manage your account"],["Privacy","Control who sees what"],["Notifications","Manage your alerts"],["Security","Password, 2FA, devices"],["Blocked Users","People you've blocked"],["Data & Storage","Your data and media"],["Help & Support","Get help"]
] as const;

export default function SettingsPage(){return <PageShell>
  <MobileHeader title="Settings" backHref="/profile"/>
  <div className="settings-profile row gap10"><img className="avatar" src={people.josh.avatar} width={43} height={43} alt=""/><div style={{flex:1}}><div className="friend-name">Josh Wyrick</div><div className="friend-sub">View your profile</div></div><ChevronRight size={17} color="var(--muted)"/></div>
  {items.map(([title,sub])=><div className="settings-row" key={title}><div><div className="settings-title">{title}</div><div className="settings-sub">{sub}</div></div><ChevronRight size={16} color="var(--muted-2)"/></div>)}
  <button className="danger-btn">Log Out</button>
</PageShell>}
