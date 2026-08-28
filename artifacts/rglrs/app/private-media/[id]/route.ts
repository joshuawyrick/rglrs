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
  const { data: postMedia } = await supabase
    .from("post_media")
    .select("id,post_id")
    .eq("id", id)
    .maybeSingle();

  let media: { object_key: string; upload_id: string | null; owner_id: string } | null = null;
  if (postMedia) {
    const { data: post } = await supabase.from("posts").select("author_id").eq("id", postMedia.post_id).single();
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
    const { data: privateMedia } = await service
      .from("post_media")
      .select("object_key,upload_id")
      .eq("id", postMedia.id)
      .maybeSingle();
    if (post && privateMedia?.object_key.startsWith(`originals/${post.author_id}/`)) {
      media = { object_key: privateMedia.object_key, upload_id: privateMedia.upload_id, owner_id: post.author_id };
    }
  } else {
    // RLS exposes message_media only while the caller remains an authorized
    // participant. The URL accepts the immutable row id, never an object key.
    const { data: messageMedia } = await supabase
      .from("message_media")
      .select("id,sender_id")
      .eq("id", id)
      .maybeSingle();
    if (!messageMedia) return NextResponse.json({ error: "Media not found" }, { status: 404 });
    const service = getSupabaseServiceClient();
    if (!service) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
    const { data: privateMedia } = await service
      .from("message_media")
      .select("object_key,upload_id")
      .eq("id", messageMedia.id)
      .maybeSingle();
    if (privateMedia?.object_key.startsWith(`originals/${messageMedia.sender_id}/`)) {
      media = { object_key: privateMedia.object_key, upload_id: privateMedia.upload_id, owner_id: messageMedia.sender_id };
    }
  }
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  const r2 = getR2();
  if (!r2) {
    return NextResponse.json({ error: "R2 is not configured" }, { status: 503 });
  }
  const range = requestedObjectRange(request.headers.get("range"));
  if (range === false) return new NextResponse(null, { status: 416, headers: { "Cache-Control": "private, no-store" } });
  let contentType: string | undefined;
  let contentLength: number | undefined;
  try {
    const head = await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: media.object_key }));
    if (head.Metadata?.owner !== media.owner_id || (media.upload_id && head.Metadata?.["upload-id"] !== media.upload_id)) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }
    contentType = head.ContentType;
    contentLength = head.ContentLength;
  } catch {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
  try {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: media.object_key,
      ...(range ? { Range: range } : {}),
    }));
    return privateObjectResponse(object, { contentType });
  } catch {
    return new NextResponse(null, {
      status: range ? 416 : 404,
      headers: {
        "Cache-Control": "private, no-store",
        ...(range && contentLength !== undefined ? { "Content-Range": `bytes */${contentLength}` } : {}),
      },
    });
  }
}