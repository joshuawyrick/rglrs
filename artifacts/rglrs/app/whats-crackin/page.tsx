import { redirect } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { WhatsCrackin } from "@/components/whats-crackin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WhatsCrackinPage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <PageShell><WhatsCrackin/></PageShell>;
}
