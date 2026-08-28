import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ALLOWED_MEDIA, cleanupExpiredUploads, getR2, MEDIA_LIMITS, safeFilename, type AllowedContentType } from "@/lib/private-media-server";
import { randomUUID } from "node:crypto";
import { logServerError } from "@/lib/server-logging";

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { contentType?: string; fileName?: string; size?: number } | null;
  if (!body?.contentType || !(body.contentType in ALLOWED_MEDIA) || typeof body.fileName !== "string" || typeof body.size !== "number") {
    return NextResponse.json({ error: "Invalid media upload request" }, { status: 400 });
  }
  const contentType = body.contentType as AllowedContentType;
  const media = ALLOWED_MEDIA[contentType];
  const maxBytes = media.mediaType === "image" ? MEDIA_LIMITS.imageBytes : MEDIA_LIMITS.videoBytes;
  if (!Number.isInteger(body.size) || body.size < 1 || body.size > maxBytes) {
    return NextResponse.json({ error: media.mediaType === "image" ? "Photos must be 15 MB or smaller." : "Videos must be 100 MB or smaller." }, { status: 400 });
  }

  const r2 = getR2();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!r2 || !url || !secret) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  await cleanupExpiredUploads(admin, r2.client, r2.bucket).catch((error) => {
    logServerError("private_media.opportunistic_cleanup_failed", error);
  });

  const uploadId = randomUUID();
  const key = `originals/${user.id}/published/${uploadId}/${randomUUID()}.${media.extension}`;
  const stagingKey = `originals/${user.id}/drafts/${uploadId}/${randomUUID()}.${media.extension}`;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const directUploadExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error: insertError } = await admin.rpc("reserve_media_upload", {
    p_id: uploadId,
    p_owner_id: user.id,
    p_object_key: key,
    p_staging_key: stagingKey,
    p_original_filename: safeFilename(body.fileName),
    p_content_type: contentType,
    p_media_type: media.mediaType,
    p_declared_size: body.size,
    p_expires_at: expiresAt,
    p_direct_upload_expires_at: directUploadExpiresAt,
  });
  if (insertError) {
    const quota = insertError.message.includes("quota exceeded");
    return NextResponse.json(
      { error: insertError.message.includes("active") ? "Finish or remove an existing upload before adding more." : quota ? "Daily media upload limit reached." : "Could not create upload session" },
      { status: quota ? 429 : 500 },
    );
  }
  try {
    const headers = { "Content-Type": contentType, "x-amz-meta-owner": user.id, "x-amz-meta-upload-id": uploadId };
    const command = new PutObjectCommand({
      Bucket: r2.bucket,
      Key: stagingKey,
      ContentLength: body.size,
      ContentType: contentType,
      Metadata: { owner: user.id, "upload-id": uploadId },
    });
    const uploadUrl = await getSignedUrl(r2.client, command, {
      expiresIn: 600,
      unhoistableHeaders: new Set(["x-amz-meta-owner", "x-amz-meta-upload-id"]),
    });
    return NextResponse.json({
      uploadId,
      uploadUrl,
      fallbackUploadUrl: `/private-media/uploads/${uploadId}/content`,
      headers,
      expiresIn: 600,
    });
  } catch (error) {
    const errorId = logServerError("private_media.upload_signing_failed", error, { uploadId });
    await admin.from("media_uploads").update({ status: "failed" }).eq("id", uploadId);
    return NextResponse.json({ error: "Could not sign media upload", errorId }, { status: 502 });
  }
}