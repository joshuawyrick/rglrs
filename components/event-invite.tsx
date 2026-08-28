"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { Check, Download, Share2 } from "lucide-react";
import { AvatarStack } from "@/components/avatar-stack";

export function EventInvite({
  eventId="emma-birthday",
  eventTitle="Emma's Birthday Dinner 🎉",
  eventDate="Sat, May 25, 2026 · 7:00 PM",
  place="The Harbor House"
}:{eventId?:string;eventTitle?:string;eventDate?:string;place?:string}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const [shared,setShared] = useState(false);
  const url = useMemo(() => `${typeof window!=="undefined"?window.location.origin:"https://rglrs.app"}/invite/demo-${eventId}`, [eventId]);

  async function shareInvite(){
    try {
      if(navigator.share) await navigator.share({title:eventTitle,text:`Join me on RGLRS for ${eventTitle}`,url});
      else if(navigator.clipboard) await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(()=>setShared(false),1800);
    } catch {}
  }

  function saveQr(){
    const svg = qrRef.current?.querySelector("svg");
    if(!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)],{type:"image/svg+xml"});
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=objectUrl; a.download=`rglrs-${eventId}-invite.svg`; a.click();
    URL.revokeObjectURL(objectUrl);
  }

  return <div className="qr-wrap">
    <div className="invite-event-title">{eventTitle}</div>
    <div className="invite-event-meta">{eventDate}<br/>{place}<br/>42 Ocean View Dr, San Diego, CA</div>
    <div style={{display:"flex",justifyContent:"center",marginTop:9}}><AvatarStack count={5} label="+4"/></div>
    <div style={{fontSize:8,color:"var(--muted)",marginTop:7}}>You're invited by Jess</div>
    <div ref={qrRef} className="qr-card"><QRCodeSVG value={url} size={205} bgColor="#ffffff" fgColor="#0b0f13" level="H" imageSettings={{src:"/icon.svg",height:42,width:42,excavate:true}}/></div>
    <h3 className="qr-title">Scan to join the event</h3>
    <p className="qr-sub">This invite is private and non-transferable.</p>
    <div className="stack gap8" style={{marginTop:16}}>
      <button className="secondary-btn" onClick={shareInvite}>{shared?<><Check size={15}/> Link copied</>:<><Share2 size={15}/> Share Invite</>}</button>
      <button className="text-btn" onClick={saveQr}><Download size={14} style={{verticalAlign:"middle",marginRight:6}}/>Save Invite</button>
      <Link href={`/invite/demo-${eventId}`} className="primary-btn">Preview Join Flow</Link>
    </div>
  </div>;
}
