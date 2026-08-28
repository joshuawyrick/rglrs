const COUNT_FIELDS = [
  "stagingScanned",
  "stagingDeleted",
  "stagingFailed",
  "scanned",
  "deleted",
  "failed",
];

function assertConfiguration({ baseUrl, secret, maxBatches }) {
  if (baseUrl !== "https://rglrs.replit.app") {
    throw new Error("NEXT_PUBLIC_APP_URL must equal https://rglrs.replit.app.");
  }
  if (!secret) {
    throw new Error("SESSION_SECRET is required.");
  }
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 50) {
    throw new Error("CLEANUP_MAX_BATCHES must be an integer from 1 to 50.");
  }
}

function validateResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Media cleanup returned an invalid response.");
  }
  if (
    !Number.isInteger(result.scanned) ||
    result.scanned < 0 ||
    !Number.isInteger(result.deleted) ||
    result.deleted < 0 ||
    !Number.isInteger(result.failed) ||
    result.failed < 0
  ) {
    throw new Error("Media cleanup returned an invalid response.");
  }
  for (const field of COUNT_FIELDS) {
    if (
      result[field] !== undefined &&
      (!Number.isInteger(result[field]) || result[field] < 0)
    ) {
      throw new Error("Media cleanup returned an invalid response.");
    }
  }
  if (result.hasMore !== undefined && typeof result.hasMore !== "boolean") {
      throw new Error("Media cleanup returned an invalid response.");
  }
}

function errorIdFrom(result) {
  return result &&
    typeof result === "object" &&
    typeof result.errorId === "string" &&
    /^[A-Za-z0-9_-]+$/.test(result.errorId)
    ? result.errorId
    : null;
}

export async function runCleanup({
  baseUrl,
  secret,
  maxBatches = 10,
  fetchImpl = globalThis.fetch,
}) {
  assertConfiguration({ baseUrl, secret, maxBatches });
  if (typeof fetchImpl !== "function") {
    throw new Error("The runtime does not provide fetch.");
  }

  const totals = {
    batches: 0,
    stagingScanned: 0,
    stagingDeleted: 0,
    stagingFailed: 0,
    scanned: 0,
    deleted: 0,
    failed: 0,
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/private-media/cleanup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(70_000),
      });
    } catch {
      throw new Error("Media cleanup request failed.");
    }

    if (response.status === 409) {
      return {
        event: "private_media.cleanup_skipped",
        reason: "already_running",
        ...totals,
      };
    }

    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok) {
      const errorId = errorIdFrom(result);
      throw new Error(
        `Media cleanup failed (${response.status})${errorId ? `; errorId=${errorId}` : ""}.`,
      );
    }

    validateResult(result);
    totals.batches += 1;
    for (const field of COUNT_FIELDS) {
      totals[field] += result[field] || 0;
    }
    if (!result.hasMore) break;
  }

  return {
    event: "private_media.cleanup_complete",
    ...totals,
  };
}