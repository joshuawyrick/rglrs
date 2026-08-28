import { notFound } from "next/navigation";
import { MoreHorizontal, Search } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { events, people } from "@/lib/demo-data";

export default async function EventMembers({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const e=events.find(x=>x.id===id); if(!e) notFound();
  const members=Object.values(people);
  return <PageShell>
    <MobileHeader title={e.title} backHref={`/events/${e.id}`}/>
    <div className="feed-tabs" style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}><span className="pill active">Members {e.members}</span><span className="pill">Invites 3</span></div>
    <div className="search-box"><Search size={15} color="var(--muted)"/><input className="input" placeholder="Search members…"/></div>
    <div style={{marginTop:9}}>{members.map((p,i)=><div className="conversation-row" key={p.name}><div style={{position:"relative"}}><img className="avatar" src={p.avatar} width={39} height={39} alt=""/>{i<3?<span className="online-dot"/>:null}</div><div className="conversation-main"><div className="conversation-name">{p.name}</div><div className="conversation-preview">{i===0?"Owner":i<3?"Admin":"Member"}</div></div><MoreHorizontal size={16} color="var(--muted)"/></div>)}</div>
  </PageShell>;
}
