import { runCleanup } from "../lib/cleanup-client.mjs";

const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
const secret = process.env.SESSION_SECRET;
const maxBatches = Number(process.env.CLEANUP_MAX_BATCHES || 10);

try {
  const result = await runCleanup({
    baseUrl,
    secret,
    maxBatches,
  });
  console.log(JSON.stringify(result));
  if (result.failed > 0 || result.stagingFailed > 0) {
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Media cleanup failed.");
  process.exitCode = 1;
}