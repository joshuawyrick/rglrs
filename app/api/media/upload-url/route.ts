import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { randomUUID } from "node:crypto";

export async function POST(request: Request) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { contentType?: string; extension?: string } | null;
  const allowed = new Set(["image/jpeg","image/png","image/webp","video/mp4","video/quicktime"]);
  if (!body?.contentType || !allowed.has(body.contentType)) return NextResponse.json({ error: "Unsupported media type" }, { status: 400 });

  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY, bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return NextResponse.json({ error: "R2 is not configured" }, { status: 503 });

  const s3 = new S3Client({ region: "auto", endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  const ext = (body.extension || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const key = `originals/${user.id}/${new Date().toISOString().slice(0,10)}/${randomUUID()}.${ext}`;
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: body.contentType, Metadata: { owner: user.id } });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
  return NextResponse.json({ uploadUrl, key, expiresIn: 300 });
}
