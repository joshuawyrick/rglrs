import { MoreHorizontal } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";

export default function NewEvent() {
  return <PageShell>
    <MobileHeader title="New Event" backHref="/events" right={<button className="screen-icon-btn"><MoreHorizontal size={18}/></button>}/>
    <div className="new-event-cover"><img src="https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200&auto=format&fit=crop" alt="Vegas skyline"/></div>
    <div className="new-event-form">
      <div><div className="form-label">Event Name</div><input className="input" defaultValue="Vegas 2026"/></div>
      <div className="form-two"><div><div className="form-label">Start Date</div><input className="input" defaultValue="May 30, 2026"/></div><div><div className="form-label">End Date</div><input className="input" defaultValue="Jun 2, 2026"/></div></div>
      <div><div className="form-label">Location</div><input className="input" defaultValue="Las Vegas, NV"/></div>
      <div><div className="form-label">Description</div><textarea className="input" rows={3} defaultValue="Our annual trip to Vegas! Good times and even better people."/></div>
      <div className="composer-option"><div><div>Privacy</div><div style={{fontSize:8,color:"var(--muted)",marginTop:3}}>Invite only</div></div><span style={{color:"var(--muted)"}}>›</span></div>
      <button className="primary-btn">Create Event</button>
    </div>
  </PageShell>;
}
