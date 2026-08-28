import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  privateObjectResponse,
  requestedObjectRange,
} from "../lib/private-media-server.ts";

const privateKey = "originals/owner-id/published/private-photo.jpg";
const bytes = new TextEncoder().encode("private media bytes");
const response = privateObjectResponse(
  {
    Body: {
      transformToWebStream: () => new Blob([bytes]).stream(),
    },
    ContentLength: bytes.byteLength,
    ContentRange: `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
    ContentType: "image/jpeg",
  },
  {
    contentDisposition: 'attachment; filename="rglrs-media.jpg"',
  },
);

assert.equal(response.status, 206);
assert.equal(response.headers.get("location"), null);
assert.equal(response.headers.get("accept-ranges"), "bytes");
assert.match(response.headers.get("cache-control") || "", /\bno-store\b/i);
assert.equal(response.headers.get("content-disposition"), 'attachment; filename="rglrs-media.jpg"');
assert.equal(new TextDecoder().decode(await response.arrayBuffer()), "private media bytes");

const serializedHeaders = JSON.stringify([...response.headers]);
assert.equal(serializedHeaders.includes(privateKey), false);
assert.equal(serializedHeaders.includes("originals/"), false);
assert.equal(requestedObjectRange("bytes=0-499"), "bytes=0-499");
assert.equal(requestedObjectRange("bytes=500-"), "bytes=500-");
assert.equal(requestedObjectRange("bytes=-500"), "bytes=-500");
assert.equal(requestedObjectRange("bytes=0-1,4-5"), false);
assert.equal(requestedObjectRange("items=0-1"), false);

const privateMediaDirectory = new URL("../app/private-media/", import.meta.url);
const routeNames = await readdir(privateMediaDirectory, { recursive: true });
let protectedReadRoutes = 0;
for (const routeName of routeNames.filter((name) => name.endsWith("route.ts"))) {
  const path = new URL(routeName, privateMediaDirectory);
  const source = await readFile(path, "utf8");
  if (!source.includes("export async function GET") || !source.includes("GetObjectCommand")) continue;
  protectedReadRoutes += 1;
  for (const forbidden of ["getSignedUrl", "NextResponse.redirect", "Response.redirect"]) {
    assert.equal(source.includes(forbidden), false, `${path.pathname} contains ${forbidden}`);
  }
  assert.equal(source.includes("privateObjectResponse"), true);
}
assert.equal(protectedReadRoutes, 4, "expected all four protected media read routes");

console.log("✓ protected media responses stream without key-bearing redirects");