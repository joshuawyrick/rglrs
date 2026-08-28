import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MEDIA_LIMITS = {
  imageBytes: 15 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  dailyBytes: 500 * 1024 * 1024,
  maxActive: 16,
  maxDimension: 12_000,
  maxVideoMs: 180_000,
} as const;

export const ALLOWED_MEDIA = {
  "image/jpeg": { extension: "jpg", mediaType: "image" },
  "image/png": { extension: "png", mediaType: "image" },
  "image/webp": { extension: "webp", mediaType: "image" },
  "video/mp4": { extension: "mp4", mediaType: "video" },
  "video/quicktime": { extension: "mov", mediaType: "video" },
} as const;

export type AllowedContentType = keyof typeof ALLOWED_MEDIA;

export function getR2() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export function safeFilename(value: string) {
  const basename = value.split(/[\\/]/).pop()?.normalize("NFKC") || "upload";
  return basename.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/\s+/g, " ").slice(0, 120) || "upload";
}

async function bytesFrom(output: GetObjectCommandOutput) {
  if (!output.Body) throw new Error("Object body is missing");
  return Buffer.from(await output.Body.transformToByteArray());
}

export async function objectRange(client: S3Client, bucket: string, key: string, start: number, end: number) {
  return bytesFrom(await client.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${end}` })));
}

export function requestedObjectRange(value: string | null) {
  if (!value) return null;
  return /^bytes=(?:\d+-\d*|-\d+)$/.test(value) ? value : false;
}

export function privateObjectResponse(
  output: GetObjectCommandOutput,
  options: { contentType?: string; contentDisposition?: string } = {},
) {
  if (!output.Body) throw new Error("Object body is missing");
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Type": output.ContentType || options.contentType || "application/octet-stream",
  });
  if (output.ContentLength !== undefined) headers.set("Content-Length", String(output.ContentLength));
  if (output.ContentRange) headers.set("Content-Range", output.ContentRange);
  if (options.contentDisposition) headers.set("Content-Disposition", options.contentDisposition);
  return new Response(output.Body.transformToWebStream(), {
    status: output.ContentRange ? 206 : 200,
    headers,
  });
}

function isPng(bytes: Buffer) {
  return bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
}

export function inspectImage(bytes: Buffer, contentType: AllowedContentType) {
  if (contentType === "image/png") {
    if (!isPng(bytes)) throw new Error("File signature does not match PNG");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (contentType === "image/jpeg") {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error("File signature does not match JPEG");
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      offset += length + 2;
    }
    throw new Error("JPEG dimensions could not be read");
  }
  if (contentType === "image/webp") {
    if (bytes.length < 30 || bytes.toString("ascii",0,4) !== "RIFF" || bytes.toString("ascii",8,12) !== "WEBP") {
      throw new Error("File signature does not match WebP");
    }
    const kind = bytes.toString("ascii",12,16);
    if (kind === "VP8X") {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3),
      };
    }
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
    throw new Error("WebP dimensions could not be read");
  }
  throw new Error("Unsupported image type");
}

function findAscii(bytes: Buffer, text: string) {
  return bytes.indexOf(Buffer.from(text, "ascii"));
}

export function inspectVideo(chunks: Buffer[]) {
  const first = chunks[0];
  if (first.length < 12 || findAscii(first.subarray(4, 32), "ftyp") < 0) throw new Error("File signature does not match MP4/QuickTime");
  for (const bytes of chunks) {
    const marker = findAscii(bytes, "mvhd");
    if (marker < 0 || marker + 36 > bytes.length) continue;
    const version = bytes[marker + 4];
    const timescale = version === 1 ? bytes.readUInt32BE(marker + 24) : bytes.readUInt32BE(marker + 16);
    const duration = version === 1 ? Number(bytes.readBigUInt64BE(marker + 28)) : bytes.readUInt32BE(marker + 20);
    if (!timescale || !Number.isFinite(duration)) break;
    return { durationMs: Math.round((duration / timescale) * 1000) };
  }
  throw new Error("Video duration could not be read");
}

export async function cleanupExpiredUploads(admin: SupabaseClient, client: S3Client, bucket: string) {
  const { data: staleStaging, error: stagingError } = await admin
    .from("media_uploads")
    .select("id,staging_key,cleanup_attempts")
    .not("staging_key", "is", null)
    .lt("direct_upload_expires_at", new Date().toISOString())
    .limit(100);
  if (stagingError) throw stagingError;
  let stagingDeleted = 0;
  let stagingFailed = 0;
  for (const upload of staleStaging ?? []) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: upload.staging_key }));
      const { error: updateError } = await admin.from("media_uploads")
        .update({ staging_key: null, cleanup_last_error: null, updated_at: new Date().toISOString() })
        .eq("id", upload.id);
      if (updateError) throw updateError;
      stagingDeleted += 1;
    } catch {
      stagingFailed += 1;
      await admin.from("media_uploads").update({
        cleanup_attempts: Number(upload.cleanup_attempts || 0) + 1,
        cleanup_last_error: "staging_delete_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", upload.id);
    }
  }
  const { data, error } = await admin
    .from("media_uploads")
    .select("id,object_key,staging_key,cleanup_attempts")
    .in("status", ["pending","promoting","uploaded","failed"])
    .lt("expires_at", new Date().toISOString())
    .order("expires_at")
    .limit(100);
  if (error) throw error;
  let deleted = 0;
  let failed = 0;
  for (const upload of data ?? []) {
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: upload.object_key }));
      if (upload.staging_key) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: upload.staging_key }));
      await admin.from("media_uploads").update({ status: "deleted", cleanup_last_error: null, updated_at: new Date().toISOString() }).eq("id", upload.id);
      deleted += 1;
    } catch (error) {
      await admin.from("media_uploads").update({
        status: "failed",
        cleanup_attempts: Number(upload.cleanup_attempts || 0) + 1,
        cleanup_last_error: "published_delete_failed",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", upload.id);
      failed += 1;
    }
  }
  return {
    stagingScanned: staleStaging?.length ?? 0,
    stagingDeleted,
    stagingFailed,
    scanned: data?.length ?? 0,
    deleted,
    failed,
    hasMore: (staleStaging?.length ?? 0) === 100 || (data?.length ?? 0) === 100,
  };
}