import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { EventMembersClient } from "@/components/event-members-client";
import { getEvent, getEventMembers } from "@/lib/event-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function EventMembers({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const supabase=await getSupabaseServerClient(); if(!supabase) redirect("/login");
  const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect("/login");
  let event; let members; let sharingExcludedIds:string[];
  try {
    const [eventResult,membersResult,sharingResult]=await Promise.all([
      getEvent(supabase,user.id,id),
      getEventMembers(supabase,id),
      supabase.from("event_media_exclusions").select("excluded_user_id").eq("event_id",id).eq("uploader_id",user.id),
    ]);
    if(sharingResult.error) throw new Error(sharingResult.error.message);
    event=eventResult;members=membersResult;
    sharingExcludedIds=(sharingResult.data||[]).map((row)=>row.excluded_user_id);
  }
  catch {return <PageShell><MobileHeader title="Event people" backHref={`/events/${id}`}/><div className="empty-state"><strong>Members unavailable</strong><span>Please try again.</span></div></PageShell>;}
  if(!event) notFound();
  let eligible:{id:string;name:string}[]=[];
  let approvalRequests:{inviteId:string;userId:string;name:string;requestedAt:string|null}[]=[];
  if(event.currentRole==="owner"||event.currentRole==="admin"){
    const {data:friendships}=await supabase.from("friendships").select("requester_id,addressee_id").eq("status","accepted").or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`);
    const ids=(friendships||[]).map((f)=>f.requester_id===user.id?f.addressee_id:f.requester_id).filter((friendId)=>!members.some((member)=>member.id===friendId));
    if(ids.length){const {data:profiles}=await supabase.from("profiles").select("id,display_name").in("id",ids); eligible=(profiles||[]).map((p)=>({id:p.id,name:p.display_name}));}
    const {data:requests}=await supabase.rpc("list_event_invite_requests_secure",{p_event:id});
    approvalRequests=((requests||[]) as Array<{invite_id:string;user_id:string;status:string;display_name?:string;redeemed_at?:string}>)
      .filter((request)=>request.status==="pending").map((request)=>({
        inviteId:request.invite_id,userId:request.user_id,name:request.display_name||"RGLR",requestedAt:request.redeemed_at||null,
      }));
  }
  return <PageShell>
    <MobileHeader title={event.title} backHref={`/events/${event.id}`}/>
    <EventMembersClient eventId={id} members={members} eligible={eligible} approvalRequests={approvalRequests} canManage={event.currentRole==="owner"||event.currentRole==="admin"} canShare={event.currentRole!=="viewer"&&event.currentParticipationMode!=="view_only"} isOwner={event.currentRole==="owner"} currentUserId={user.id} sharingExcludedIds={sharingExcludedIds}/>
  </PageShell>;
}