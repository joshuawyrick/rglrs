"use client";

import { Check, Search, UsersRound } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventMember } from "@/lib/event-data";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function EventMembersClient({eventId,members,eligible,approvalRequests,canManage,canShare,isOwner,currentUserId,sharingExcludedIds}:{eventId:string;members:EventMember[];eligible:{id:string;name:string}[];approvalRequests:{inviteId:string;userId:string;name:string;requestedAt:string|null}[];canManage:boolean;canShare:boolean;isOwner:boolean;currentUserId:string;sharingExcludedIds:string[]}) {
  const router=useRouter(); const [query,setQuery]=useState(""); const [busy,setBusy]=useState<string|null>(null); const [error,setError]=useState<string|null>(null);
  const [sharingOpen,setSharingOpen]=useState(false);
  const [excludedIds,setExcludedIds]=useState(sharingExcludedIds);
  const [sharingSaved,setSharingSaved]=useState(false);
  const visible=members.filter((member)=>`${member.name} ${member.username}`.toLowerCase().includes(query.toLowerCase()));
  async function setMember(userId:string,role:EventMember["role"],present:boolean){
    const supabase=getSupabaseBrowserClient(); if(!supabase)return setError("Member controls are unavailable.");
    setBusy(userId);setError(null);
    const {error:rpcError}=await supabase.rpc("set_event_member_secure",{p_event:eventId,p_user:userId,p_role:role,p_present:present});
    setBusy(null); if(rpcError)return setError("Could not update this event member."); router.refresh();
  }
  async function decide(inviteId:string,userId:string,accept:boolean){
    const supabase=getSupabaseBrowserClient();if(!supabase)return setError("Approval controls are unavailable.");
    setBusy(userId);setError(null);
    const {error:rpcError}=await supabase.rpc("decide_event_invite_redemption_secure",{p_invite:inviteId,p_user:userId,p_accept:accept});
    setBusy(null);if(rpcError)return setError("Could not update this invite request.");router.refresh();
  }
  async function saveSharing(){
    const supabase=getSupabaseBrowserClient();if(!supabase)return setError("Sharing controls are unavailable.");
    setBusy("sharing");setError(null);setSharingSaved(false);
    const {error:rpcError}=await supabase.rpc("set_event_media_sharing_secure",{p_event:eventId,p_excluded_users:excludedIds});
    setBusy(null);
    if(rpcError)return setError("Could not save your sharing choices.");
    setSharingSaved(true);router.refresh();
  }
  const sharingMembers=members.filter((member)=>member.id!==currentUserId);
  const modeLabel=(mode:EventMember["participationMode"])=>mode==="upload_only"?"Upload only":mode==="view_only"?"View only":"Participate";
  return <>
    <div className="feed-tabs" style={{display:"grid",gridTemplateColumns:"1fr 1fr"}}><span className="pill active">Members {members.length}</span><span className="pill">Private event</span></div>
    {canShare?<section className="card card-pad event-sharing-card" aria-labelledby="my-sharing-title">
      <div className="row space gap10">
        <div className="row gap10">
          <span className="event-sharing-icon"><UsersRound size={17}/></span>
          <div><div className="conversation-name" id="my-sharing-title">My sharing</div><div className="conversation-preview">{excludedIds.length?`Hidden from ${excludedIds.length} ${excludedIds.length===1?"member":"members"}`:"Shared with all event members"}</div></div>
        </div>
        <button className="secondary-btn" type="button" onClick={()=>setSharingOpen((open)=>!open)}>{sharingOpen?"Close":"Manage"}</button>
      </div>
      {sharingOpen?<div className="event-sharing-editor">
        <p className="form-hint">These members stay in the event, but they will not see your existing or future event uploads.</p>
        {!sharingMembers.length?<div className="form-hint">There are no other event members to manage.</div>:sharingMembers.map((member)=>{
          const excluded=excludedIds.includes(member.id);
          return <label className="event-sharing-member" key={member.id}>
            <img className="avatar" src={member.avatar} width={34} height={34} alt=""/>
            <span className="conversation-main"><span className="conversation-name">{member.name}</span><span className="conversation-preview">{excluded?"Cannot see your event media":"Can see your event media"}</span></span>
            <input type="checkbox" checked={excluded} onChange={()=>{setSharingSaved(false);setExcludedIds((current)=>excluded?current.filter((id)=>id!==member.id):[...current,member.id]);}} aria-label={`Hide my event media from ${member.name}`}/>
          </label>;
        })}
        <div className="row space gap8 event-sharing-actions">
          <span className="form-hint">{sharingSaved?<><Check size={12}/> Saved</>:"Download and membership permissions are unchanged."}</span>
          <button className="primary-btn" type="button" onClick={saveSharing} disabled={busy==="sharing"}>{busy==="sharing"?"Saving…":"Save sharing"}</button>
        </div>
      </div>:null}
    </section>:null}
    <label className="search-box"><Search size={15} color="var(--muted)"/><input className="input" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search members…"/></label>
    {canManage&&eligible.length?<div className="card card-pad" style={{marginTop:9}}><div className="form-label">Add accepted friend</div><select className="input" defaultValue="" onChange={(e)=>{if(e.target.value)setMember(e.target.value,"member",true);}} disabled={!!busy}><option value="">Choose a friend…</option>{eligible.map((friend)=><option key={friend.id} value={friend.id}>{friend.name}</option>)}</select></div>:null}
    {error?<div className="form-error" role="alert">{error}</div>:null}
    {canManage&&approvalRequests.length?<div className="card card-pad" style={{marginTop:9}}><div className="form-label">Pending approvals</div>{approvalRequests.map((request)=><div className="conversation-row" key={`${request.inviteId}-${request.userId}`}><div className="conversation-main"><div className="conversation-name">{request.name}</div><div className="conversation-preview">{request.requestedAt?`Requested ${new Date(request.requestedAt).toLocaleDateString()}`:"Requested access"}</div></div><div className="row gap6"><button className="primary-btn" disabled={busy===request.userId} onClick={()=>decide(request.inviteId,request.userId,true)}>Approve</button><button className="text-btn" disabled={busy===request.userId} onClick={()=>decide(request.inviteId,request.userId,false)}>Decline</button></div></div>)}</div>:null}
    {!visible.length?<div className="empty-state"><strong>No members found</strong><span>{query?"Try another search.":"Invite an accepted friend to get started."}</span></div>:null}
    <div style={{marginTop:9}}>{visible.map((member)=><div className="conversation-row" key={member.id}>
      <img className="avatar" src={member.avatar} width={39} height={39} alt=""/>
      <div className="conversation-main"><div className="conversation-name">{member.name}</div><div className="conversation-preview">{member.role} · {modeLabel(member.participationMode)}{member.username?` · @${member.username}`:""}</div></div>
      {canManage&&member.id!==currentUserId&&member.role!=="owner"&&(isOwner||member.role!=="admin")?<div className="row gap6"><select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy===member.id} onChange={(e)=>setMember(member.id,e.target.value as EventMember["role"],true)}>{isOwner?<option value="admin">Admin</option>:null}<option value="member">Member</option><option value="viewer">Viewer</option></select><button className="text-btn" disabled={busy===member.id} onClick={()=>setMember(member.id,member.role,false)}>Remove</button></div>:null}
    </div>)}</div>
  </>;
}