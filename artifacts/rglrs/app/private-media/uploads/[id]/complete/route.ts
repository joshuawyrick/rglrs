import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getR2, inspectImage, inspectVideo, MEDIA_LIMITS, objectRange, type AllowedContentType } from "@/lib/private-media-server";
import { logServerError } from "@/lib/server-logging";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r2 = getR2();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!r2 || !url || !secret) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const { id } = await params;
  const now = new Date().toISOString();
  const { data: upload } = await admin
    .from("media_uploads")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .gt("expires_at", now)
    .maybeSingle();
  if (!upload || !["pending","uploaded"].includes(upload.status)) return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  if (upload.status === "uploaded") {
    return NextResponse.json({ uploadId: upload.id, mediaType: upload.media_type, width: upload.width, height: upload.height, durationMs: upload.duration_ms });
  }
  try {
    if (!upload.staging_key) throw new Error("Upload staging object is missing");
    const { data: promotionStarted, error: promotionError } = await admin.rpc("begin_media_promotion", {
      p_id: upload.id,
      p_owner_id: user.id,
    });
    if (promotionError) throw promotionError;
    if (!promotionStarted) return NextResponse.json({ error: "Upload session expired or is already being checked" }, { status: 409 });
    await r2.client.send(new CopyObjectCommand({
      Bucket: r2.bucket,
      Key: upload.object_key,
      CopySource: `${r2.bucket}/${upload.staging_key}`,
      ContentType: upload.content_type,
      MetadataDirective: "REPLACE",
      Metadata: { owner: user.id, "upload-id": upload.id },
    }));
    const head = await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: upload.object_key }));
    const size = Number(head.ContentLength || 0);
    if (size !== Number(upload.declared_size)) throw new Error("Uploaded file size changed");
    if (head.ContentType !== upload.content_type) throw new Error("Uploaded content type changed");
    if (head.Metadata?.owner !== user.id || head.Metadata?.["upload-id"] !== upload.id) throw new Error("Uploaded object ownership is invalid");
    const contentType = upload.content_type as AllowedContentType;
    let width: number | null = null;
    let height: number | null = null;
    let durationMs: number | null = null;
    if (upload.media_type === "image") {
      const dimensions = inspectImage(await objectRange(r2.client, r2.bucket, upload.object_key, 0, Math.min(size - 1, 1024 * 1024 - 1)), contentType);
      width = dimensions.width;
      height = dimensions.height;
      if (width < 1 || height < 1 || width > MEDIA_LIMITS.maxDimension || height > MEDIA_LIMITS.maxDimension) throw new Error("Image dimensions are unsupported");
    } else {
      const chunkSize = Math.min(size, 8 * 1024 * 1024);
      const first = await objectRange(r2.client, r2.bucket, upload.object_key, 0, chunkSize - 1);
      const chunks = [first];
      if (size > chunkSize) chunks.push(await objectRange(r2.client, r2.bucket, upload.object_key, Math.max(0, size - chunkSize), size - 1));
      durationMs = inspectVideo(chunks).durationMs;
      if (durationMs < 1 || durationMs > MEDIA_LIMITS.maxVideoMs) throw new Error("Videos must be 3 minutes or shorter");
    }
    const { data: completed, error } = await admin.rpc("complete_media_upload", {
      p_id: upload.id,
      p_owner_id: user.id,
      p_validated_size: size,
      p_width: width,
      p_height: height,
      p_duration_ms: durationMs,
    });
    if (error) throw error;
    if (!completed) {
      await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: upload.object_key }));
      return NextResponse.json({ error: "Upload session expired" }, { status: 410 });
    }
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: upload.staging_key })).catch((error) => {
      logServerError("private_media.staging_cleanup_failed", error, { uploadId: upload.id });
    });
    return NextResponse.json({ uploadId: upload.id, mediaType: upload.media_type, width, height, durationMs });
  } catch (error) {
    const errorId = logServerError("private_media.validation_failed", error, {
      uploadId: upload.id,
    });
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: upload.object_key })).catch(() => undefined);
    await admin.from("media_uploads").update({ status: "failed", expires_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", upload.id).eq("owner_id", user.id);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Media validation failed", errorId }, { status: 400 });
  }
}