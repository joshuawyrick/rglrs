"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { formatEventDate } from "@/lib/event-data";

type Preview={event:{id:string;title:string;startsAt:string|null;endsAt:string|null;placeName:string|null;placeAddress:string|null};mode:string;requiresPin:boolean;inviter:string;memberCount:number};
export function InviteRedemption({token}:{token:string}){
  const router=useRouter();const [preview,setPreview]=useState<Preview|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [pin,setPin]=useState("");
  useEffect(()=>{let active=true;(async()=>{const response=await fetch(`/event-invites/${encodeURIComponent(token)}`,{cache:"no-store"});const body=await response.json();if(!active)return;if(response.ok)setPreview(body);else setError(body.error||"This invite is unavailable.");setLoading(false);})();return()=>{active=false};},[token]);
  async function join(){setBusy(true);setError(null);const response=await fetch(`/event-invites/${encodeURIComponent(token)}/redeem`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pin:pin||null})});const body=await response.json();setBusy(false);if(response.status===401)return router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);if(!response.ok)return setError(body.error||"Could not join this event.");router.push(`/invite/accepted?event=${encodeURIComponent(body.eventId)}&title=${encodeURIComponent(preview?.event.title||"the event")}&status=${body.status==="pending"?"pending":"joined"}`);}
  return <div className="auth-shell"><div className="auth-card glass" style={{paddingTop:12}}>
    <div className="row space"><Link href="/" className="screen-icon-btn"><X size={18}/></Link><span style={{fontSize:11,fontWeight:700}}>Event Invite</span><span style={{width:40}}/></div>
    {loading?<div className="feed-loader" aria-label="Loading invite"><span/></div>:!preview?<div className="empty-state"><strong>Invite unavailable</strong><span>{error}</span></div>:<div style={{textAlign:"center",padding:"10px 0"}}>
      <div style={{display:"grid",placeItems:"center"}}><BrandMark size={55}/></div><div className="invite-event-title">{preview.event.title}</div>
      <div className="invite-event-meta">{formatEventDate(preview.event.startsAt,preview.event.endsAt)}<br/>{[preview.event.placeName,preview.event.placeAddress].filter(Boolean).join(" · ")||"Location to be announced"}</div>
      <div style={{fontSize:8,color:"var(--muted)",marginTop:10}}>{preview.memberCount} {preview.memberCount===1?"member":"members"}</div>
      <div style={{fontSize:8,color:"var(--muted)",marginTop:8}}>You’re invited by {preview.inviter}</div>
      <div className="card card-pad" style={{marginTop:18,textAlign:"left"}}><div className="friend-name">Private invitation</div><div className="friend-sub">Access mode: {preview.mode.replaceAll("_"," ")}. Joining grants access only to this event.</div></div>
      {preview.requiresPin?<label style={{display:"block",textAlign:"left",marginTop:12}}><span className="form-label">Invite PIN</span><input className="input" type="password" inputMode="numeric" value={pin} onChange={(e)=>setPin(e.target.value)} autoComplete="one-time-code"/></label>:null}
      {error?<div className="form-error" role="alert">{error}</div>:null}
      <button onClick={join} disabled={busy||(preview.requiresPin&&!pin)} className="primary-btn" style={{width:"100%",marginTop:16}}>{busy?"Submitting…":preview.mode==="approval"?"Request to Join":"Join Event"}</button>
      <Link href="/" className="secondary-btn" style={{width:"100%",marginTop:8}}>Not now</Link>
    </div>}
  </div></div>;
}