import Link from "next/link";
import { redirect } from "next/navigation";
import { Filter, Plus } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { AvatarStack } from "@/components/avatar-stack";
import { formatEventDate, getEvents, type EventSummary } from "@/lib/event-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ tab?: string; filter?: string }> }) {
  const params = await searchParams;
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  let events: EventSummary[];
  let error: string | null = null;
  try { events = await getEvents(supabase, user.id); }
  catch { events = []; error = "We couldn’t load your events. Please try again."; }
  const now = Date.now();
  const tab = params.tab === "past" ? "past" : "upcoming";
  const filter = params.filter === "owned" || params.filter === "joined" ? params.filter : "all";
  const timed = events.filter((event) => tab === "past"
    ? Boolean(event.endsAt && new Date(event.endsAt).getTime() < now)
    : !event.endsAt || new Date(event.endsAt).getTime() >= now);
  const visible = timed.filter((event) => filter === "owned" ? event.ownerId === user.id : filter === "joined" ? event.ownerId !== user.id : true);

  return <PageShell>
    <div className="row space" style={{minHeight:52}}>
      <h1 style={{margin:0,fontSize:18}}>Events</h1>
      <div className="row gap6">
        <Link className="primary-btn events-create-button" href="/events/new"><Plus size={15}/><span>Create event</span></Link>
        <details style={{position:"relative"}}>
          <summary className="screen-icon-btn" aria-label="Filter events" style={{listStyle:"none"}}><Filter size={16}/></summary>
          <div className="card card-pad stack gap8" style={{position:"absolute",right:0,top:38,zIndex:20,minWidth:150}}>
            <strong style={{fontSize:10}}>Show events</strong>
            {(["all","owned","joined"] as const).map((value) => <Link key={value} className={filter === value ? "teal" : "text-btn"} href={`/events?tab=${tab}&filter=${value}`}>{value === "all" ? "All events" : value === "owned" ? "Organized by me" : "Joined events"}</Link>)}
          </div>
        </details>
      </div>
    </div>
    <div className="feed-tabs" style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:5}}>
      <Link className={`pill ${tab === "upcoming" ? "active" : ""}`} href={`/events?tab=upcoming&filter=${filter}`}>Upcoming</Link>
      <Link className={`pill ${tab === "past" ? "active" : ""}`} href={`/events?tab=past&filter=${filter}`}>Past</Link>
    </div>
    {error ? <div className="empty-state"><strong>Events unavailable</strong><span>{error}</span><Link className="secondary-btn" href={`/events?tab=${tab}&filter=${filter}`}>Try again</Link></div> : null}
    {!error && !visible.length ? <div className="empty-state"><strong>No {tab} events{filter !== "all" ? " matching this filter" : ""}</strong><span>{tab === "upcoming" ? "Plan a private gathering, then invite the people who should be there." : "Past events will appear here."}</span>{filter !== "all" ? <Link className="text-btn" href={`/events?tab=${tab}&filter=all`}>Show all events</Link> : tab === "upcoming" ? <Link className="primary-btn" href="/events/new"><Plus size={15}/>Create your first event</Link> : null}</div> : null}
    <div className="events-list">
      {visible.map((event) => <Link key={event.id} href={`/events/${event.id}`} className="event-row-card">
        {event.coverUrl ? <img src={event.coverUrl} alt=""/> : <div className="event-cover-fallback" aria-hidden="true"/>}
        <div className="event-row-body">
          <div style={{fontSize:7.5,color:"var(--teal)",fontWeight:800}}>{event.startsAt ? new Date(event.startsAt).toLocaleDateString(undefined,{month:"short",day:"numeric"}).toUpperCase() : "DATE TBA"}</div>
          <div className="event-row-title">{event.title}</div>
          <div className="event-row-meta">{formatEventDate(event.startsAt,event.endsAt,event.allDay,event.timezone)}</div>
          <div className="event-row-meta">{event.placeName || event.placeAddress || "Location to be announced"}</div>
          {event.placeName && event.placeAddress ? <div className="event-row-meta event-location-address">{event.placeAddress}</div> : null}
          {event.currentParticipationMode==="upload_only"?<div className="event-row-meta">Upload-only access</div>:event.currentParticipationMode==="view_only"||event.currentRole==="viewer"?<div className="event-row-meta">View-only access</div>:null}
          <div style={{marginTop:7}}><AvatarStack avatars={event.avatars} count={4} label={`${event.memberCount} ${event.memberCount === 1 ? "member" : "members"}`}/></div>
        </div>
      </Link>)}
    </div>
  </PageShell>;
}