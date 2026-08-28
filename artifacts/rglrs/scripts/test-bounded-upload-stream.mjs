import {
  boundedUploadBody,
  hasExactContentLength,
} from "../lib/bounded-upload-stream.ts";

function webStream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  });
}

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

if (hasExactContentLength(null, 4)) throw new Error("Missing Content-Length was accepted.");
if (hasExactContentLength("5", 4)) throw new Error("Mismatched Content-Length was accepted.");
if (!hasExactContentLength("4", 4)) throw new Error("Exact Content-Length was rejected.");

const exact = await collect(boundedUploadBody(webStream(["ab", "cd"]), 4));
if (exact.toString() !== "abcd") throw new Error("Exact bounded stream was changed.");

for (const [label, chunks] of [
  ["oversized", ["abcd", "e"]],
  ["truncated", ["abc"]],
]) {
  let rejected = false;
  try {
    await collect(boundedUploadBody(webStream(chunks), 4));
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`${label} bounded stream was accepted.`);
}

console.log("✓ fallback upload rejects absent, mismatched, oversized, and truncated bodies");