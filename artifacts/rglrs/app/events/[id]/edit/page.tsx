import { notFound, redirect } from "next/navigation";
import { EventForm } from "@/components/new-event-form";
import { MobileHeader } from "@/components/mobile-header";
import { PageShell } from "@/components/page-shell";
import { getEvent } from "@/lib/event-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const event = await getEvent(supabase, user.id, id).catch(() => null);
  if (!event) notFound();
  if (event.currentRole !== "owner" && event.currentRole !== "admin") redirect(`/events/${id}`);
  return <PageShell>
    <MobileHeader title="Edit event" backHref={`/events/${id}`}/>
    <div className="event-create-intro"><div className="eyebrow">PRIVATE EVENT</div><h1>Event details</h1><p>Changes are visible to everyone in this event.</p></div>
    <EventForm event={event}/>
  </PageShell>;
}