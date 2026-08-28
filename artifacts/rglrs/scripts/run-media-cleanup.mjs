const baseUrl = (process.env.CLEANUP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
const secret = process.env.SESSION_SECRET;
const maxBatches = Number(process.env.CLEANUP_MAX_BATCHES || 10);

if (!/^https?:\/\//.test(baseUrl) || !secret) {
  console.error("Media cleanup requires CLEANUP_BASE_URL (or NEXT_PUBLIC_APP_URL) and SESSION_SECRET.");
  process.exit(1);
}
if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 50) {
  console.error("CLEANUP_MAX_BATCHES must be an integer from 1 to 50.");
  process.exit(1);
}

let totals = { batches: 0, stagingScanned: 0, stagingDeleted: 0, stagingFailed: 0, scanned: 0, deleted: 0, failed: 0 };
for (let batch = 0; batch < maxBatches; batch += 1) {
  const response = await fetch(`${baseUrl}/private-media/cleanup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(70_000),
  });
  if (response.status === 409) {
    console.log("Private-media cleanup is already running.");
    break;
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Private-media cleanup failed (${response.status})${result.errorId ? `; errorId=${result.errorId}` : ""}.`);
  }
  totals = {
    batches: totals.batches + 1,
    stagingScanned: totals.stagingScanned + Number(result.stagingScanned || 0),
    stagingDeleted: totals.stagingDeleted + Number(result.stagingDeleted || 0),
    stagingFailed: totals.stagingFailed + Number(result.stagingFailed || 0),
    scanned: totals.scanned + Number(result.scanned || 0),
    deleted: totals.deleted + Number(result.deleted || 0),
    failed: totals.failed + Number(result.failed || 0),
  };
  if (!result.hasMore) break;
}

console.log(JSON.stringify({ event: "private_media.cleanup_complete", ...totals }));
if (totals.failed > 0 || totals.stagingFailed > 0) process.exitCode = 2;