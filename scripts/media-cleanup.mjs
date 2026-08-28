import { runCleanup } from '../lib/cleanup-client.mjs';

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const sessionSecret = process.env.SESSION_SECRET;
const maxBatches = Number.parseInt(process.env.CLEANUP_MAX_BATCHES || '10', 10);

try {
  const result = await runCleanup({ appUrl, sessionSecret, maxBatches });
  if (result.inProgress) {
    console.log('Cleanup already in progress; treating 409 as a safe no-op.');
    process.exit(0);
  }

  const payload = result.result || {};
  console.log(JSON.stringify({
    batches: payload.batches ?? null,
    scanned: payload.scanned ?? 0,
    deleted: payload.deleted ?? 0,
    failed: payload.failed ?? 0,
    stagingScanned: payload.stagingScanned ?? 0,
    stagingDeleted: payload.stagingDeleted ?? 0,
    stagingFailed: payload.stagingFailed ?? 0,
  }, null, 2));
  process.exit(0);
} catch (error) {
  const safeMessage = error instanceof Error ? error.message : 'Unknown cleanup error';
  console.error(`RGLRS media cleanup failed: ${safeMessage}`);
  process.exit(error?.cleanupFailed ? 2 : 1);
}
