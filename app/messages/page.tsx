import Link from "next/link";
import { Edit3, Search } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { conversations } from "@/lib/demo-data";

export default function MessagesPage() {
  return <PageShell>
    <div className="row space" style={{minHeight:52}}><h1 style={{margin:0,fontSize:18}}>Messages</h1><button className="screen-icon-btn"><Edit3 size={17}/></button></div>
    <div className="search-box"><Search size={15} color="var(--muted)"/><input className="input" placeholder="Search people, events, posts…"/></div>
    <div className="message-list" style={{marginTop:7}}>{conversations.map(c=><Link href={`/messages/${c.id}`} className="conversation-row" key={c.id}><img className="avatar" src={c.person.avatar} width={42} height={42} alt=""/><div className="conversation-main"><div className="conversation-name">{c.name}</div><div className="conversation-preview">{c.preview}</div></div><div className="stack" style={{alignItems:"flex-end",gap:6}}><span className="conversation-time">{c.time}</span>{c.unread?<span className="unread-badge">{c.unread}</span>:null}</div></Link>)}</div>
  </PageShell>;
}
