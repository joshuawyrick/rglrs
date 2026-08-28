import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getR2 } from "@/lib/private-media-server";
import { boundedUploadBody, hasExactContentLength } from "@/lib/bounded-upload-stream";
import { logServerError } from "@/lib/server-logging";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const { data: upload } = await admin
    .from("media_uploads")
    .select("id,owner_id,staging_key,content_type,declared_size,status,expires_at,direct_upload_expires_at")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!upload || !upload.staging_key || upload.status !== "pending" || new Date(upload.expires_at).getTime() <= Date.now() || new Date(upload.direct_upload_expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "Upload session not found" }, { status: 404 });
  }
  if (request.headers.get("content-type") !== upload.content_type) {
    return NextResponse.json({ error: "Uploaded content type changed" }, { status: 400 });
  }
  const expectedBytes = Number(upload.declared_size);
  if (!hasExactContentLength(request.headers.get("content-length"), expectedBytes)) {
    return NextResponse.json({ error: "Uploaded file size changed" }, { status: 400 });
  }
  if (!request.body) return NextResponse.json({ error: "Uploaded file is missing" }, { status: 400 });
  const body = boundedUploadBody(request.body, expectedBytes);
  try {
    await r2.client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: upload.staging_key,
      Body: body,
      ContentLength: expectedBytes,
      ContentType: upload.content_type,
      Metadata: { owner: user.id, "upload-id": upload.id },
    }), { abortSignal: request.signal });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const errorId = logServerError("private_media.same_origin_upload_failed", error, {
      uploadId: upload.id,
    });
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: upload.staging_key })).catch(() => undefined);
    await admin.from("media_uploads").update({
      status: "failed",
      expires_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", upload.id).eq("owner_id", user.id).eq("status", "pending");
    return NextResponse.json({ error: "Could not upload media", errorId }, { status: 502 });
  }
}