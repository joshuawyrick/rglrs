import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { notifications } from "@/lib/demo-data";

export default function Notifications() {
  return <PageShell>
    <MobileHeader title="Notifications" backHref="/"/>
    <div className="list-section-label">Today</div>
    {notifications.slice(0,3).map(n=><div className="notification-row" key={n.id}><img className="avatar" src={n.person.avatar} width={37} height={37} alt=""/><div className="notification-text"><strong>{n.person.name}</strong> {n.text}<span className="notification-time">{n.time}</span></div><span style={{fontSize:15}}>•••</span></div>)}
    <div className="list-section-label">This Week</div>
    {notifications.slice(3,5).map(n=><div className="notification-row" key={n.id}><img className="avatar" src={n.person.avatar} width={37} height={37} alt=""/><div className="notification-text"><strong>{n.person.name}</strong> {n.text}<span className="notification-time">{n.time}</span></div><span style={{fontSize:15}}>•••</span></div>)}
    <div className="list-section-label">Earlier</div>
    {notifications.slice(5).map(n=><div className="notification-row" key={n.id}><img className="avatar" src={n.person.avatar} width={37} height={37} alt=""/><div className="notification-text"><strong>{n.person.name}</strong> {n.text}<span className="notification-time">{n.time}</span></div><span style={{fontSize:15}}>•••</span></div>)}
  </PageShell>;
}
