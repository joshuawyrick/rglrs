import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getR2, privateObjectResponse, requestedObjectRange } from "@/lib/private-media-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: event } = await supabase
    .from("events")
    .select("id,cover_upload_id")
    .eq("id", id)
    .maybeSingle();
  if (!event?.cover_upload_id) return NextResponse.json({ error: "Event cover not found" }, { status: 404 });

  const service = getSupabaseServiceClient();
  const r2 = getR2();
  if (!service || !r2) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
  const { data: upload } = await service
    .from("media_uploads")
    .select("id,object_key,owner_id,status,media_type")
    .eq("id", event.cover_upload_id)
    .eq("status", "claimed")
    .eq("media_type", "image")
    .maybeSingle();
  if (!upload) return NextResponse.json({ error: "Event cover not found" }, { status: 404 });

  const range = requestedObjectRange(request.headers.get("range"));
  if (range === false) return new NextResponse(null, { status: 416, headers: { "Cache-Control": "private, no-store" } });
  try {
    const head = await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: upload.object_key }));
    if (head.Metadata?.owner !== upload.owner_id || head.Metadata?.["upload-id"] !== upload.id) {
      return NextResponse.json({ error: "Event cover not found" }, { status: 404 });
    }
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: upload.object_key,
      ...(range ? { Range: range } : {}),
    }));
    return privateObjectResponse(object, { contentType: head.ContentType });
  } catch {
    return new NextResponse(null, { status: range ? 416 : 404, headers: { "Cache-Control": "private, no-store" } });
  }
}