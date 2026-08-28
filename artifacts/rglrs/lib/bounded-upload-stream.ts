import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export function hasExactContentLength(value: string | null, expectedBytes: number) {
  if (!value || !/^\d+$/.test(value)) return false;
  return Number(value) === expectedBytes;
}

export function boundedUploadBody(body: ReadableStream<Uint8Array>, expectedBytes: number) {
  let received = 0;
  const source = Readable.fromWeb(body as NodeReadableStream<Uint8Array>);
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > expectedBytes) {
        callback(new Error("Uploaded file exceeds its reserved size"));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (received !== expectedBytes) {
        callback(new Error("Uploaded file does not match its reserved size"));
        return;
      }
      callback();
    },
  });
  return source.pipe(limiter);
}