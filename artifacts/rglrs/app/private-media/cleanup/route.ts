import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanupExpiredUploads, getR2 } from "@/lib/private-media-server";
import { logServerError } from "@/lib/server-logging";

function authorized(request: Request) {
  const expected = process.env.SESSION_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r2 = getR2();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!r2 || !url || !secret) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: claimed, error: claimError } = await admin.rpc("claim_private_media_cleanup");
  if (claimError) {
    const errorId = logServerError("private_media.cleanup_claim_failed", claimError);
    return NextResponse.json({ error: "Media cleanup failed", errorId }, { status: 500 });
  }
  if (!claimed) return NextResponse.json({ error: "Media cleanup is already running" }, { status: 409 });
  try {
    const mediaResult = await cleanupExpiredUploads(admin, r2.client, r2.bucket);
    const { data: locationRowsPruned, error: locationError } = await admin.rpc("prune_expired_locations_secure");
    if (locationError) {
      const errorId = logServerError("whats_crackin.location_cleanup_failed", locationError);
      return NextResponse.json({ error: "Location cleanup failed", errorId, ...mediaResult }, { status: 500 });
    }
    return NextResponse.json({ ...mediaResult, locationRowsPruned: Number(locationRowsPruned || 0) });
  } catch (error) {
    const errorId = logServerError("private_media.cleanup_failed", error);
    return NextResponse.json({ error: "Media cleanup failed", errorId }, { status: 500 });
  } finally {
    const { error: releaseError } = await admin.rpc("release_private_media_cleanup");
    if (releaseError) logServerError("private_media.cleanup_release_failed", releaseError);
  }
}
