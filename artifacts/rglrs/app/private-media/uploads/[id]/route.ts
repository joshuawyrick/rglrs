import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getR2 } from "@/lib/private-media-server";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .select("id,object_key,staging_key,status")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!upload) return NextResponse.json({ deleted: true });
  if (upload.status === "claimed") return NextResponse.json({ error: "Published media cannot be removed as a draft" }, { status: 409 });
  try {
    await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: upload.object_key }));
    if (upload.staging_key) {
      await r2.client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: upload.staging_key }));
    }
    await admin.from("media_uploads").update({
      status: "deleted",
      staging_key: null,
      updated_at: new Date().toISOString(),
    }).eq("id", upload.id);
    return NextResponse.json({ deleted: true });
  } catch {
    await admin.from("media_uploads").update({ status: "failed", expires_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", upload.id);
    return NextResponse.json({ error: "Could not remove media yet" }, { status: 502 });
  }
}