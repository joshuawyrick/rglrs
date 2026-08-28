import assert from "node:assert/strict";
import { test } from "node:test";
import { runCleanup } from "../lib/cleanup-client.mjs";

const baseUrl = "https://rglrs.replit.app";

function result(overrides = {}) {
  return {
    stagingScanned: 0,
    stagingDeleted: 0,
    stagingFailed: 0,
    scanned: 0,
    deleted: 0,
    failed: 0,
    hasMore: false,
    ...overrides,
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

test("runs bounded batches and sends the bearer secret", async () => {
  const requests = [];
  const responses = [
    response(200, result({ scanned: 100, deleted: 99, hasMore: true })),
    response(200, result({ scanned: 1, deleted: 1 })),
  ];

  const outcome = await runCleanup({
    baseUrl,
    secret: `local-test-${Date.now()}`,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
  });

  assert.equal(outcome.batches, 2);
  assert.equal(outcome.deleted, 100);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `${baseUrl}/private-media/cleanup`);
  assert.match(requests[0].options.headers.Authorization, /^Bearer local-test-/);
  assert.equal(requests[0].options.method, "POST");
});

test("accepts the older deployed response shape", async () => {
  const outcome = await runCleanup({
    baseUrl,
    secret: "local-test",
    fetchImpl: async () => response(200, { scanned: 0, deleted: 0, failed: 0 }),
  });

  assert.equal(outcome.event, "private_media.cleanup_complete");
  assert.equal(outcome.batches, 1);
  assert.equal(outcome.stagingScanned, 0);
});

test("treats cleanup lease contention as a successful no-op", async () => {
  const outcome = await runCleanup({
    baseUrl,
    secret: "local-test",
    fetchImpl: async () => response(409, { error: "Media cleanup is already running" }),
  });

  assert.equal(outcome.event, "private_media.cleanup_skipped");
  assert.equal(outcome.reason, "already_running");
  assert.equal(outcome.batches, 0);
});

test("fails when the cleanup request cannot be sent", async () => {
  await assert.rejects(
    runCleanup({
      baseUrl,
      secret: "local-test",
      fetchImpl: async () => {
        throw new Error("simulated transport failure");
      },
    }),
    /request failed/,
  );
});

test("fails on authentication and unexpected HTTP responses", async () => {
  for (const status of [401, 500]) {
    await assert.rejects(
      runCleanup({
        baseUrl,
        secret: "local-test",
        fetchImpl: async () => response(status, { error: "safe error" }),
      }),
      new RegExp(`failed \\(${status}\\)`),
    );
  }
});

test("fails on malformed successful responses", async () => {
  await assert.rejects(
    runCleanup({
      baseUrl,
      secret: "local-test",
      fetchImpl: async () => response(200, { hasMore: false }),
    }),
    /invalid response/,
  );
});

test("returns a result that the CLI can turn into a nonzero failure", async () => {
  const outcome = await runCleanup({
    baseUrl,
    secret: "local-test",
    fetchImpl: async () => response(200, result({ failed: 1 })),
  });

  assert.equal(outcome.failed, 1);
  assert.ok(outcome.failed > 0);
});

test("rejects a non-production target and missing secret", async () => {
  await assert.rejects(
    runCleanup({
      baseUrl: "https://example.invalid",
      secret: "local-test",
      fetchImpl: async () => response(200, result()),
    }),
    /NEXT_PUBLIC_APP_URL/,
  );
  await assert.rejects(
    runCleanup({
      baseUrl,
      secret: "",
      fetchImpl: async () => response(200, result()),
    }),
    /SESSION_SECRET/,
  );
});