export async function runCleanup({ appUrl, sessionSecret, maxBatches = 10, fetchImpl = fetch }) {
  if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is required');
  if (!sessionSecret) throw new Error('SESSION_SECRET is required');

  const url = new URL('/private-media/cleanup', appUrl).toString();
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sessionSecret}`,
      'x-session-secret': sessionSecret,
    },
    body: JSON.stringify({ maxBatches }),
  });

  if (response.status === 409) {
    return { ok: true, inProgress: true, status: 409 };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Cleanup request failed with HTTP ${response.status}`;
    const err = new Error(message);
    err.httpStatus = response.status;
    throw err;
  }

  const failed = Number(payload?.failed || 0) + Number(payload?.stagingFailed || 0);
  if (failed > 0) {
    const err = new Error(`Cleanup reported ${failed} failed deletion(s)`);
    err.cleanupFailed = true;
    err.result = payload;
    throw err;
  }

  return { ok: true, status: response.status, result: payload };
}
