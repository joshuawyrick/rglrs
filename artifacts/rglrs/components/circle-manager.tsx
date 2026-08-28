"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Circle={id:string;name:string;emoji:string|null;members:string[]};
export function CircleManager({initialCircles,friends}:{initialCircles:Circle[];friends:{id:string;name:string}[]}){
  const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=new FormData(event.currentTarget);const name=String(form.get("name")||"").trim();if(!name)return;const supabase=getSupabaseBrowserClient();if(!supabase)return setError("Circles are unavailable.");setBusy(true);const {error:e}=await supabase.rpc("create_circle_secure",{p_name:name,p_emoji:String(form.get("emoji")||"").trim()||null});setBusy(false);if(e)return setError(e.message);event.currentTarget.reset();router.refresh();}
  async function setMembers(circleId:string,members:string[]){const supabase=getSupabaseBrowserClient();if(!supabase)return setError("Circles are unavailable.");setBusy(true);const {error:e}=await supabase.rpc("set_circle_members_secure",{p_circle:circleId,p_members:members});setBusy(false);if(e)return setError(e.message);router.refresh();}
  return <section className="card card-pad" style={{marginTop:14}}><h2 className="section-title">Circles</h2><p className="friend-sub">Group accepted friends for private sharing.</p>
    <form className="row gap8" onSubmit={create}><input className="input" name="emoji" maxLength={8} placeholder="🙂" style={{width:54}}/><input className="input" name="name" maxLength={80} required placeholder="Close friends"/><button className="primary-btn" disabled={busy}>Add</button></form>
    {error?<div className="form-error" role="alert">{error}</div>:null}
    {!initialCircles.length?<div className="friend-sub" style={{marginTop:10}}>No circles yet.</div>:initialCircles.map((circle)=><div key={circle.id} style={{marginTop:12}}><div className="friend-name">{circle.emoji} {circle.name}</div><div className="audience-chips">{friends.map((friend)=><button type="button" key={friend.id} className={`audience-chip ${circle.members.includes(friend.id)?"selected":""}`} disabled={busy} onClick={()=>setMembers(circle.id,circle.members.includes(friend.id)?circle.members.filter((id)=>id!==friend.id):[...circle.members,friend.id])}>{friend.name}{circle.members.includes(friend.id)?" ×":""}</button>)}</div></div>)}
  </section>;
}