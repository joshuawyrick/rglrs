import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

async function auth() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data, error } = await session.supabase.rpc("list_signup_invites_secure");
  if (error) return NextResponse.json({ error: "Could not load invitations." }, { status: 403 });
  return NextResponse.json({ invites: data || [] });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let body: { label?: string | null; expiresAt?: string; maxUses?: number | null };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const expiry = new Date(body.expiresAt || "");
  const label = typeof body.label === "string" ? body.label.trim() : null;
  if (Number.isNaN(expiry.getTime()) || expiry <= new Date() || expiry.getTime() > Date.now() + 365 * 86400000) {
    return NextResponse.json({ error: "Expiry must be in the future and within one year." }, { status: 400 });
  }
  if (label && label.length > 80) return NextResponse.json({ error: "Label must be 80 characters or fewer." }, { status: 400 });
  if (body.maxUses != null && (!Number.isInteger(body.maxUses) || body.maxUses < 1 || body.maxUses > 10000)) {
    return NextResponse.json({ error: "Max uses must be between 1 and 10,000." }, { status: 400 });
  }
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token).digest("hex");
  const { error } = await session.supabase.rpc("create_signup_invite_secure", {
    p_token_hash: digest, p_label: label, p_expires_at: expiry.toISOString(), p_max_uses: body.maxUses ?? null,
  });
  if (error) return NextResponse.json({ error: "Could not create invitation." }, { status: 403 });
  return NextResponse.json({ path: `/join/${token}` });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let inviteId = "";
  try { inviteId = String((await request.json()).inviteId || ""); } catch {}
  const { data, error } = await session.supabase.rpc("revoke_signup_invite_secure", { p_invite: inviteId });
  if (error || !data) return NextResponse.json({ error: "Could not revoke invitation." }, { status: 403 });
  return NextResponse.json({ ok: true });
}