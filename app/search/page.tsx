import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { events, people, posts } from "@/lib/demo-data";

export default function SearchPage() {
  const recent=[people.mike,people.sarah,people.jess];
  return <PageShell>
    <div className="row space" style={{minHeight:52}}><h1 style={{margin:0,fontSize:18}}>Search</h1></div>
    <div className="search-box"><SearchIcon size={15} color="var(--muted)"/><input className="input" placeholder="Search people, events, posts…"/></div>
    <div style={{fontSize:8,color:"var(--muted)",marginTop:12}}>Recent</div>
    <div className="recent-people">
      <Link href="/events/vegas-2026" className="recent-person"><img src={events[0].image} alt=""/><span>Vegas 2026</span></Link>
      {recent.map(p=><div className="recent-person" key={p.name}><img src={p.avatar} alt=""/><span>{p.name.split(" ")[0]}</span></div>)}
    </div>
    <div style={{fontSize:8,color:"var(--muted)",marginBottom:4}}>Results</div>
    <Link href="/events/vegas-2026" className="search-result-row"><img className="search-result-thumb" src={events[0].image} alt=""/><div><div className="friend-name">Vegas 2026</div><div className="friend-sub">Event</div></div></Link>
    <div className="search-result-row"><img className="search-result-thumb" style={{borderRadius:"50%"}} src={people.mike.avatar} alt=""/><div><div className="friend-name">Mike Thompson</div><div className="friend-sub">Friend</div></div></div>
    <div className="search-result-row"><img className="search-result-thumb" style={{borderRadius:"50%"}} src={people.sarah.avatar} alt=""/><div><div className="friend-name">Sarah Johnson</div><div className="friend-sub">Friend</div></div></div>
    <Link href="/events/cabin-weekend" className="search-result-row"><img className="search-result-thumb" src={events[2].image} alt=""/><div><div className="friend-name">Cabin Weekend</div><div className="friend-sub">Event</div></div></Link>
    <Link href="/post/p1" className="search-result-row"><img className="search-result-thumb" src={posts[0].image} alt=""/><div><div className="friend-name">Beach day with the crew</div><div className="friend-sub">Post · May 12, 2026</div></div></Link>
  </PageShell>;
}
