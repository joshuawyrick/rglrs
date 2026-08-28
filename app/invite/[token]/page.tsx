import Link from "next/link";
import { X } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { AvatarStack } from "@/components/avatar-stack";

export default async function InvitePage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  return <div className="auth-shell"><div className="auth-card glass" style={{paddingTop:12}}>
    <div className="row space"><Link href="/" className="screen-icon-btn"><X size={18}/></Link><span style={{fontSize:11,fontWeight:700}}>Event Invite</span><span style={{width:40}}/></div>
    <div style={{textAlign:"center",padding:"10px 0"}}>
      <div style={{display:"grid",placeItems:"center"}}><BrandMark size={55}/></div>
      <div className="invite-event-title">Emma’s Birthday Dinner 🎉</div>
      <div className="invite-event-meta">Sat, May 25, 2026 · 7:00 PM<br/>The Harbor House<br/>42 Ocean View Dr, San Diego, CA</div>
      <div style={{display:"flex",justifyContent:"center",marginTop:10}}><AvatarStack count={5} label="+4"/></div>
      <div style={{fontSize:8,color:"var(--muted)",marginTop:8}}>You’re invited by Jess</div>
      <div className="card card-pad" style={{marginTop:18,textAlign:"left"}}><div className="friend-name">Private invitation</div><div className="friend-sub">Invite token {token.slice(0,12)}… will be verified server-side in production. Joining gives you access only to this event.</div></div>
      <Link href="/invite/accepted" className="primary-btn" style={{width:"100%",marginTop:16}}>Join Event</Link>
      <Link href="/" className="secondary-btn" style={{width:"100%",marginTop:8}}>Not now</Link>
    </div>
  </div></div>;
}
