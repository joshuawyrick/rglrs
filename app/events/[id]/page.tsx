import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MoreHorizontal, Plus, Share2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { AvatarStack } from "@/components/avatar-stack";
import { FeedPost } from "@/components/feed";
import { events, posts } from "@/lib/demo-data";

export default async function EventPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const e=events.find(x=>x.id===id);
  if(!e) notFound();
  return (
    <PageShell>
      <div style={{position:"relative"}}>
        <div className="row space" style={{position:"absolute",zIndex:5,top:4,left:0,right:0}}>
          <Link href="/events" className="screen-icon-btn" style={{background:"rgba(5,8,10,.45)"}}><ChevronLeft size={20}/></Link>
          <div className="row gap6"><Link href={`/events/${e.id}/invite`} className="screen-icon-btn" style={{background:"rgba(5,8,10,.45)"}}><Share2 size={16}/></Link><button className="screen-icon-btn" style={{background:"rgba(5,8,10,.45)"}}><MoreHorizontal size={18}/></button></div>
        </div>
        <div className="event-hero">
          <img src={e.image} alt=""/>
          <div className="event-hero-overlay">
            <h1>{e.title}</h1>
            <div className="event-hero-meta">{e.date}</div>
            <div className="row space" style={{marginTop:10}}><AvatarStack count={6} label={`${e.members} members`}/></div>
          </div>
        </div>
      </div>
      <div className="event-nav-tabs">
        <Link className="event-tab active" href={`/events/${e.id}`}>Feed</Link>
        <Link className="event-tab" href={`/events/${e.id}/gallery`}>Gallery</Link>
        <Link className="event-tab" href={`/events/${e.id}/members`}>People</Link>
        <span className="event-tab">About</span>
      </div>
      <div className="row gap10" style={{padding:"0 0 8px"}}>
        <img className="avatar" src={posts[1].author.avatar} width={29} height={29} alt=""/>
        <div><div style={{fontSize:9.5,fontWeight:700}}>Sarah Johnson</div><div style={{fontSize:7.5,color:"var(--muted-2)"}}>in · {e.title}</div></div>
      </div>
      <div className="event-feed-copy">Can’t wait for this crew to get together again!</div>
      <FeedPost post={{...posts[1],audience:e.title}}/>
      <Link href="/create" className="floating-create"><Plus size={22}/></Link>
    </PageShell>
  );
}
