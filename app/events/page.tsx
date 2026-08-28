import Link from "next/link";
import { Filter, Plus } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { events, people } from "@/lib/demo-data";
import { AvatarStack } from "@/components/avatar-stack";

export default function EventsPage() {
  return (
    <PageShell>
      <div className="row space" style={{minHeight:52}}>
        <h1 style={{margin:0,fontSize:18}}>Events</h1>
        <div className="row gap6">
          <Link className="screen-icon-btn" href="/events/new" aria-label="Create event"><Plus size={18}/></Link>
          <button className="screen-icon-btn" aria-label="Filter"><Filter size={16}/></button>
        </div>
      </div>
      <div className="feed-tabs" style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:5}}>
        <span className="pill active">Upcoming</span><span className="pill">Past</span><span className="pill">Invites</span>
      </div>
      <div className="events-list">
        {events.map((e) => (
          <Link key={e.id} href={`/events/${e.id}`} className="event-row-card">
            <img src={e.image} alt=""/>
            <div className="event-row-body">
              <div style={{fontSize:7.5,color:"var(--teal)",fontWeight:800}}>{e.shortDate}</div>
              <div className="event-row-title">{e.title}</div>
              <div className="event-row-meta">{e.date}</div>
              <div className="event-row-meta">{e.place}</div>
              <div style={{marginTop:7}}><AvatarStack count={4} label={`${e.members} members`}/></div>
            </div>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
