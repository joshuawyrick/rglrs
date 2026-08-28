import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const json = (body: object, init?: ResponseInit) => NextResponse.json(body, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers).entries()), "Cache-Control": "private, no-store, max-age=0" } });
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) return json({ error: "This invitation is invalid." }, { status: 404 });
  const service = getSupabaseServiceClient();
  if (!service) return json({ error: "Invitation preview is unavailable." }, { status: 503 });
  const digest = createHash("sha256").update(token).digest("hex");
  const { data: invite, error } = await service.from("signup_invites")
    .select("created_by,label,expires_at,max_uses,use_count,revoked_at").eq("token_hash", digest).maybeSingle();
  if (error || !invite || invite.revoked_at || new Date(invite.expires_at) <= new Date() || (invite.max_uses != null && invite.use_count >= invite.max_uses)) {
    return json({ error: "This invitation is invalid, expired, or no longer available." }, { status: 404 });
  }
  const { data: inviter } = await service.from("profiles").select("id,display_name,username").eq("id", invite.created_by).maybeSingle();
  if (!inviter) return json({ error: "This invitation is unavailable." }, { status: 404 });
  return json({ inviter: { id: inviter.id, name: inviter.display_name || inviter.username || "A RGLRS member", username: inviter.username }, label: invite.label });
}