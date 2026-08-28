"use client";

import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { EventSummary } from "@/lib/event-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function EventManage({event}:{event:EventSummary}) {
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const owner=event.currentRole==="owner";
  async function act(kind:"leave"|"delete") {
    if(kind==="delete"&&!window.confirm("Delete this event permanently?")) return;
    const supabase=getSupabaseBrowserClient(); if(!supabase) return setError("Event controls are unavailable.");
    setBusy(true); setError(null);
    const result=kind==="delete"
      ? await supabase.rpc("delete_event_secure",{p_event:event.id})
      : await supabase.rpc("leave_event_secure",{p_event:event.id});
    setBusy(false);
    if(result.error) return setError(result.error.message);
    router.push("/events"); router.refresh();
  }
  return <div style={{position:"relative"}}>
    <button className="screen-icon-btn" style={{background:"rgba(5,8,10,.45)"}} onClick={()=>setOpen(!open)} aria-label="Event controls"><MoreHorizontal size={18}/></button>
    {open?<div className="card card-pad" style={{position:"absolute",right:0,top:42,width:190,zIndex:10}}>
      <div style={{fontSize:9,fontWeight:700,marginBottom:8}}>Event controls</div>
      {(event.currentRole==="owner"||event.currentRole==="admin")?<Link className="secondary-btn" style={{width:"100%",marginBottom:7}} href={`/events/${event.id}/edit`}>Edit event</Link>:null}
      <button className="secondary-btn" style={{width:"100%"}} disabled={busy} onClick={()=>act(owner?"delete":"leave")}>{owner?"Delete event":"Leave event"}</button>
      {error?<div className="form-error" role="alert">{error}</div>:null}
    </div>:null}
  </div>;
}