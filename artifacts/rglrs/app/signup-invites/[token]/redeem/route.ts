import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return NextResponse.json({ error: "This invitation is invalid." }, { status: 404 });
  const digest = createHash("sha256").update(token).digest("hex");
  const { data, error } = await supabase.rpc("redeem_signup_invite_secure", { p_token_hash: digest });
  if (error || !data) return NextResponse.json({ error: "This invitation could not be redeemed." }, { status: 403 });
  return NextResponse.json({ inviterId: data });
}