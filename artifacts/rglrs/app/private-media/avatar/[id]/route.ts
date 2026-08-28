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
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,avatar_upload_id")
    .eq("avatar_upload_id", id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
  const [{ data: canViewProfile }, { data: canViewPhoto }] = await Promise.all([
    supabase.rpc("can_view_profile", { p_owner: profile.id, p_person: user.id }),
    supabase.rpc("can_view_profile_photo", { p_owner: profile.id, p_person: user.id }),
  ]);
  if (!canViewProfile || !canViewPhoto) {
    return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
  }

  const r2 = getR2();
  const service = getSupabaseServiceClient();
  if (!r2 || !service) return NextResponse.json({ error: "Private media is not configured" }, { status: 503 });
  const { data: upload } = await service
    .from("media_uploads")
    .select("id,object_key,owner_id,status,media_type")
    .eq("id", id)
    .eq("owner_id", profile.id)
    .eq("status", "claimed")
    .eq("media_type", "image")
    .maybeSingle();
  if (!upload) return NextResponse.json({ error: "Avatar not found" }, { status: 404 });

  const range = requestedObjectRange(request.headers.get("range"));
  if (range === false) return new NextResponse(null, { status: 416, headers: { "Cache-Control": "private, no-store" } });
  let contentType: string | undefined;
  let contentLength: number | undefined;
  try {
    const head = await r2.client.send(new HeadObjectCommand({ Bucket: r2.bucket, Key: upload.object_key }));
    if (head.Metadata?.owner !== profile.id || head.Metadata?.["upload-id"] !== upload.id) {
      return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
    }
    contentType = head.ContentType;
    contentLength = head.ContentLength;
  } catch {
    return NextResponse.json({ error: "Avatar not found" }, { status: 404 });
  }
  try {
    const object = await r2.client.send(new GetObjectCommand({
      Bucket: r2.bucket,
      Key: upload.object_key,
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