import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Event location is unavailable." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to view this event." }, { status: 401 });

  const { data, error } = await supabase.from("events")
    .select("place_name,place_address")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "Event location was not found." }, { status: 404 });

  return NextResponse.json(
    { name: data.place_name || "", address: data.place_address || "" },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}