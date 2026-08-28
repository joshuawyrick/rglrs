import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getR2, privateObjectResponse, requestedObjectRange } from "@/lib/private-media-server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: media } = await supabase
    .from("post_media")
    .select("id,post_id,media_type")
    .eq("id", id)
    .maybeSingle();
  if (!media) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  const { data: post } = await supabase
    .from("posts")
    .select("author_id,allow_downloads")
    .eq("id", media.post_id)
    .maybeSingle();
  const [{ data: canViewPost }, { data: canDownloadMedia }] = post ? await Promise.all([
    supabase.rpc("can_view_post", { p_post: media.post_id, p_user: user.id }),
    supabase.rpc("can_download_media", { p_owner: post.author_id, p_person: user.id }),
  ]) : [{ data: false }, { data: false }];
  if (!post || !canViewPost || (post.author_id !== user.id && (!post.allow_downloads || !canDownloadMedia))) {
    return NextResponse.json({ error: "Download not allowed" }, { status: 403 });
  }
  const service = getSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
  const { data: privateMedia } = await service
    .from("post_media")
    .select("object_key,upload_id")
    .eq("id", media.id)
    .maybeSingle();
  if (!privateMedia?.object_key.startsWith(`originals/${post.author_id}/`)) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const r2 = getR2();
  if (!r2) return NextResponse.json({ error: "R2 is not configured" }, { status: 503 });
  const range = requestedObjectRange(request.headers.get("range"));
  if (range === false) return new NextResponse(null, { status: 416, headers: { "Cache-Control": "private, no-store" } });
  let contentType: string | undefined;
  let contentLength: number | undefined;
  try {
    const head = await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: privateMedia.object_key }));
    if (head.Metadata?.owner !== post.author_id || (privateMedia.upload_id && head.Metadata?.["upload-id"] !== privateMedia.upload_id)) {
      return NextResponse.json({ error: "Media not found" }, { status: 404 });
    }
    contentType = head.ContentType;
    contentLength = head.ContentLength;
  } catch {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const fallbackExtension = media.media_type === "video" ? "mp4" : "jpg";
  const keyExtension = privateMedia.object_key.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  const filename = `rglrs-${media.id}.${keyExtension || fallbackExtension}`;
  try {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: privateMedia.object_key,
      ...(range ? { Range: range } : {}),
    }));
    return privateObjectResponse(object, {
      contentType,
      contentDisposition: `attachment; filename="${filename}"`,
    });
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