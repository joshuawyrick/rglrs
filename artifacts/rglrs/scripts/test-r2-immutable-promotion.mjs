import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error("R2 immutability test requires the configured private bucket.");
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});
const testId = randomUUID();
const owner = `test-${testId}`;
const uploadId = randomUUID();
const stagingKey = `originals/_tests/${testId}/drafts/source.bin`;
const finalKey = `originals/_tests/${testId}/published/final.bin`;
const original = Buffer.from(`validated-original-${randomUUID()}`);
const oversizedReplacement = Buffer.concat([original, Buffer.from("-oversized")]);
const sameSizeReplacement = Buffer.alloc(original.length, 0x78);
const headers = {
  "Content-Type": "application/octet-stream",
  "x-amz-meta-owner": owner,
  "x-amz-meta-upload-id": uploadId,
};

try {
  const signedPut = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: stagingKey,
      ContentLength: original.length,
      ContentType: headers["Content-Type"],
      Metadata: { owner, "upload-id": uploadId },
    }),
    {
      expiresIn: 300,
      unhoistableHeaders: new Set(["x-amz-meta-owner", "x-amz-meta-upload-id"]),
    },
  );
  const firstPut = await fetch(signedPut, { method: "PUT", headers, body: original });
  if (!firstPut.ok) throw new Error(`Initial signed staging PUT failed (${firstPut.status}): ${(await firstPut.text()).slice(0,500)}`);

  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: finalKey,
    CopySource: `${bucket}/${stagingKey}`,
    ContentType: headers["Content-Type"],
    MetadataDirective: "REPLACE",
    Metadata: { owner, "upload-id": uploadId },
  }));

  const oversizedPut = await fetch(signedPut, { method: "PUT", headers, body: oversizedReplacement });
  if (oversizedPut.ok) throw new Error("Signed staging PUT accepted bytes beyond its declared size.");

  const latePut = await fetch(signedPut, { method: "PUT", headers, body: sameSizeReplacement });
  if (!latePut.ok) throw new Error(`Same-size late staging PUT failed (${latePut.status}): ${(await latePut.text()).slice(0,500)}`);

  const finalObject = await client.send(new GetObjectCommand({ Bucket: bucket, Key: finalKey }));
  if (!finalObject.Body) throw new Error("Promoted final object is missing.");
  const finalBytes = Buffer.from(await finalObject.Body.transformToByteArray());
  if (!finalBytes.equals(original)) {
    throw new Error("Late staging PUT changed the promoted final object.");
  }
  console.log("✓ signed staging PUT enforces size and cannot change promoted media");
} finally {
  await Promise.allSettled([
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: stagingKey })),
    client.send(new DeleteObjectCommand({ Bucket: bucket, Key: finalKey })),
  ]);
}