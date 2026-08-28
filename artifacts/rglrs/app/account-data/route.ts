import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null) as { confirmation?: unknown; password?: unknown } | null;
  if (!body || body.confirmation !== "DELETE" || typeof body.password !== "string" || body.password.length < 6) return NextResponse.json({ error: "A DELETE confirmation and password are required" }, { status: 400 });
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: "A password-authenticated account is required" }, { status: 400 });
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email: user.email, password: body.password });
  if (reauthError) return NextResponse.json({ error: "Password verification failed" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY, bucket = process.env.R2_BUCKET;
  if (!url || !secret || !accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return NextResponse.json({ error: "Account deletion is temporarily unavailable" }, { status: 503 });
  }
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
  const prefix = `originals/${user.id}/`;
  const { error: operationError } = await admin.from("account_deletion_operations").upsert({
    user_id: user.id, object_prefix: prefix, status: "removing_media", last_error: null, updated_at: new Date().toISOString(),
  });
  if (operationError) return NextResponse.json({ error: "Could not start a recoverable deletion operation" }, { status: 500 });
  try {
    const s3 = new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
    let continuationToken: string | undefined;
    do {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      const keys = (listed.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []);
      if (keys.length) {
        const deleted = await s3.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }));
        if (deleted.Errors?.length) throw new Error("R2 returned object deletion errors");
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    const remaining = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }));
    if ((remaining.KeyCount ?? remaining.Contents?.length ?? 0) > 0) throw new Error("R2 objects remain after cleanup");
  } catch {
    await admin.from("account_deletion_operations").update({ last_error: "media_cleanup_failed", updated_at: new Date().toISOString() }).eq("user_id", user.id);
    return NextResponse.json({ error: "Could not remove your private media. Your account was not deleted." }, { status: 502 });
  }
  await admin.from("account_deletion_operations").update({ status: "media_removed", last_error: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    await admin.from("account_deletion_operations").update({ last_error: "auth_deletion_failed", updated_at: new Date().toISOString() }).eq("user_id", user.id);
    return NextResponse.json({ error: "Private media was removed. Account deletion remains pending and can be safely retried." }, { status: 500 });
  }
  await admin.from("account_deletion_operations").update({ status: "complete", last_error: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  return NextResponse.json({ deleted: true });
}