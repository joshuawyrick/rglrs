import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Plus, Share2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { AvatarStack } from "@/components/avatar-stack";
import { FeedPost } from "@/components/feed";
import { EventManage } from "@/components/event-manage";
import { formatEventDate, getEvent, getEventPosts } from "@/lib/event-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function EventPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const supabase=await getSupabaseServerClient();
  if(!supabase) redirect("/login");
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) redirect("/login");
  let event; let posts;
  try { [event,posts]=await Promise.all([getEvent(supabase,user.id,id),getEventPosts(supabase,id,user.id)]); }
  catch { return <PageShell><div className="empty-state"><strong>Event unavailable</strong><span>It may have been removed, or you may no longer have access.</span><Link href="/events" className="secondary-btn">Back to events</Link></div></PageShell>; }
  if(!event) notFound();
  const canManage=event.currentRole==="owner"||event.currentRole==="admin";
  const canInvite=canManage||event.membersCanInvite;
  const canPost=event.currentRole!=="viewer"&&event.currentParticipationMode!=="view_only";
  return <PageShell>
    <div style={{position:"relative"}}>
      <div className="row space" style={{position:"absolute",zIndex:5,top:4,left:0,right:0}}>
        <Link href="/events" className="screen-icon-btn" style={{background:"rgba(5,8,10,.45)"}}><ChevronLeft size={20}/></Link>
        <div className="row gap6">{canInvite?<Link href={`/events/${event.id}/invite`} className="screen-icon-btn" style={{background:"rgba(5,8,10,.45)"}}><Share2 size={16}/></Link>:null}<EventManage event={event}/></div>
      </div>
      <div className="event-hero">
        {event.coverUrl?<img src={event.coverUrl} alt=""/>:<div className="event-cover-fallback" style={{height:"100%"}}/>}
        <div className="event-hero-overlay"><h1>{event.title}</h1><div className="event-hero-meta">{formatEventDate(event.startsAt,event.endsAt,event.allDay,event.timezone)}{event.placeName||event.placeAddress?<><br/>{event.placeName||event.placeAddress}{event.placeName&&event.placeAddress?<><br/><span className="event-location-address">{event.placeAddress}</span></>:null}</>:null}</div>
          <div className="row space" style={{marginTop:10}}><AvatarStack avatars={event.avatars} count={6} label={`${event.memberCount} members`}/></div>
        </div>
      </div>
    </div>
    <div className="event-nav-tabs">
      <Link className="event-tab active" href={`/events/${event.id}`}>Feed</Link>
      <Link className="event-tab" href={`/events/${event.id}/gallery`}>Gallery</Link>
      <Link className="event-tab" href={`/events/${event.id}/members`}>People</Link>
      <span className="event-tab" title={event.description}>{event.description?"About":"Private"}</span>
    </div>
    {event.currentParticipationMode==="upload_only"?<div className="form-hint">Upload-only access: you can share event media, but not text-only posts.</div>:null}
    {!posts.length?<div className="empty-state"><strong>No event posts yet</strong><span>Share the first memory with this event.</span></div>:posts.map((post)=><FeedPost key={post.id} post={post} userId={user.id}/>)}
    {canPost?<Link href={`/create?audience=events&subjects=${event.id}`} className="floating-create" aria-label={event.currentParticipationMode==="upload_only"?"Upload event media":"Create event post"}><Plus size={22}/></Link>:null}
  </PageShell>;
}