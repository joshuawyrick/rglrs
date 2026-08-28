import Link from "next/link";
import { Check } from "lucide-react";

export default async function InviteAccepted({searchParams}:{searchParams:Promise<{event?:string;title?:string;status?:string}>}){
  const {event,title,status}=await searchParams;
  const safeEvent=event&&/^[0-9a-f-]{36}$/i.test(event)?event:null;
  const pending=status==="pending";
  return <div className="auth-shell"><div className="invite-success" style={{width:"min(100%,390px)"}}><div className="confetti">• ˚ ✦ ˚ •</div><div className="success-ring"><Check size={40}/></div><h1 style={{fontSize:20,margin:"0 0 6px"}}>{pending?"Request sent":"You’re in! 🎉"}</h1><p style={{fontSize:9,color:"var(--muted)",lineHeight:1.55,margin:"0 0 24px"}}>{pending?<>An event admin will review your request to join<br/>{title||"the event"}.</>:<>You’ve joined<br/>{title||"the event"}.</>}</p>{safeEvent&&!pending?<Link href={`/events/${safeEvent}`} className="primary-btn" style={{width:"100%"}}>View Event</Link>:null}<Link href="/events" className="secondary-btn" style={{width:"100%",marginTop:9}}>Back to Events</Link></div></div>;
}