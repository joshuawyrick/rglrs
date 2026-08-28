import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { MobileHeader } from "@/components/mobile-header";
import { NewEventForm } from "@/components/new-event-form";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewEvent() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <PageShell>
    <MobileHeader title="New Event" backHref="/events"/>
    <div className="event-create-intro">
      <div className="eyebrow">PRIVATE EVENT</div>
      <h1>Plan a gathering</h1>
      <p>Add the basic details now. After you create it, you can invite friends and manage who can participate.</p>
      <div className="event-create-flow"><span className="active">1. Details</span><span>2. Invite people</span><span>3. Share memories</span></div>
    </div>
    <NewEventForm/>
  </PageShell>;
}