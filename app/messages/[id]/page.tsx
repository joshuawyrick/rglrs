import { notFound } from "next/navigation";
import { Info, Mic, Plus, Video } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { conversations, people } from "@/lib/demo-data";

export default async function ChatPage({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const c=conversations.find(x=>x.id===id); if(!c) notFound();
  return <PageShell>
    <div className="chat-screen">
      <MobileHeader title="" backHref="/messages" right={<div className="row gap6"><button className="screen-icon-btn"><Video size={17}/></button><button className="screen-icon-btn"><Info size={17}/></button></div>}/>
      <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",top:13}} className="row gap8"><img className="avatar" src={c.person.avatar} width={28} height={28} alt=""/><div><div style={{fontSize:10,fontWeight:700}}>{c.name}</div>{c.members?<div style={{fontSize:7,color:"var(--muted)"}}>{c.members}</div>:null}</div></div>
      <div className="chat-body">
        <div className="bubble-row"><img className="avatar" src={people.jess.avatar} width={24} height={24} alt=""/><div><div className="bubble">Weekend hike?<img className="chat-image" src="https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&auto=format&fit=crop" alt="Mountain hike"/></div><div className="chat-time">10:15 AM</div></div></div>
        <div className="bubble-row mine"><div><div className="bubble mine">Count me in! 🙌 🥾</div><div className="chat-time">10:16 AM ✓✓</div></div></div>
        <div className="bubble-row"><img className="avatar" src={people.mike.avatar} width={24} height={24} alt=""/><div><div className="bubble">I’ll bring snacks.<div style={{color:"var(--warning)",marginTop:5}}>🔥 2</div></div><div className="chat-time">10:18 AM</div></div></div>
        <div className="bubble-row"><img className="avatar" src={people.taylor.avatar} width={24} height={24} alt=""/><div><div className="bubble">Perfect. See you Saturday!!<div style={{color:"var(--teal)",marginTop:5}}>♥ 3</div></div><div className="chat-time">10:18 AM</div></div></div>
      </div>
      <div className="chat-compose"><button className="screen-icon-btn"><Plus size={17}/></button><input className="input" placeholder={`Message ${c.name}…`}/><button className="screen-icon-btn"><Mic size={16}/></button></div>
    </div>
  </PageShell>;
}
