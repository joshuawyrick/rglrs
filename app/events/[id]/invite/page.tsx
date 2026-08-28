import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { EventInvite } from "@/components/event-invite";
import { events } from "@/lib/demo-data";

export default async function InviteScreen({params}:{params:Promise<{id:string}>}) {
  const {id}=await params; const e=events.find(x=>x.id===id); if(!e) notFound();
  return <PageShell><MobileHeader title="Event Invite" backHref={`/events/${e.id}`}/><EventInvite eventId={e.id} eventTitle={e.title} eventDate={e.date} place={e.place}/></PageShell>;
}
