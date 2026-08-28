import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { EventInvite } from "@/components/event-invite";
import { formatEventDate, getEvent } from "@/lib/event-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function InviteScreen({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;const supabase=await getSupabaseServerClient();if(!supabase)redirect("/login");
  const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/login");
  let event;try{event=await getEvent(supabase,user.id,id);}catch{return <PageShell><div className="empty-state"><strong>Invites unavailable</strong><span>Please try again.</span></div></PageShell>;}
  if(!event)notFound();if(!(event.currentRole==="owner"||event.currentRole==="admin"||event.membersCanInvite))notFound();
  const place=[event.placeName,event.placeAddress].filter(Boolean).join(" · ");
  return <PageShell><MobileHeader title="Event Invite" backHref={`/events/${event.id}`}/><EventInvite eventId={event.id} eventTitle={event.title} eventDate={formatEventDate(event.startsAt,event.endsAt,event.allDay,event.timezone)} place={place||null} avatars={event.avatars}/></PageShell>;
}