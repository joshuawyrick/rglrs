import test from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../lib/cleanup-client.mjs';

const secret = 'test-secret';
const appUrl = 'https://rglrs.replit.app';

test('requires app URL', async () => {
  await assert.rejects(() => runCleanup({ sessionSecret: secret, fetchImpl: async () => {} }), /NEXT_PUBLIC_APP_URL/);
});

test('requires session secret', async () => {
  await assert.rejects(() => runCleanup({ appUrl, fetchImpl: async () => {} }), /SESSION_SECRET/);
});

test('treats 409 as safe no-op', async () => {
  const result = await runCleanup({
    appUrl,
    sessionSecret: secret,
    fetchImpl: async () => new Response('', { status: 409 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.inProgress, true);
});

test('throws on authentication failure', async () => {
  await assert.rejects(
    () => runCleanup({
      appUrl,
      sessionSecret: secret,
      fetchImpl: async () => new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /Unauthorized/,
  );
});

test('throws when cleanup reports deletion failures', async () => {
  await assert.rejects(
    () => runCleanup({
      appUrl,
      sessionSecret: secret,
      fetchImpl: async () => new Response(JSON.stringify({ failed: 1, stagingFailed: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    }),
    /failed deletion/,
  );
});

test('returns successful cleanup result', async () => {
  const result = await runCleanup({
    appUrl,
    sessionSecret: secret,
    fetchImpl: async () => new Response(JSON.stringify({
      batches: 1,
      scanned: 0,
      deleted: 0,
      failed: 0,
      stagingScanned: 0,
      stagingDeleted: 0,
      stagingFailed: 0,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.result.failed, 0);
});
