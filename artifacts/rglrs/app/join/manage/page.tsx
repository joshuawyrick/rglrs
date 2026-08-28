import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MobileHeader } from "@/components/mobile-header";
import { PageShell } from "@/components/page-shell";
import { SignupInviteManager } from "@/components/signup-invite-manager";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Manage invitations · RGLRS", robots: { index: false, follow: false } };

export default async function ManageInvitationsPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (!user) redirect(`/login?next=${encodeURIComponent("/join/manage")}`);
  return <PageShell><MobileHeader title="Invite people" backHref="/settings" /><SignupInviteManager /></PageShell>;
}