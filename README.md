# RGLRS Media Cleanup Scheduler

Standalone Replit Scheduled Deployment source for triggering the production RGLRS private-media cleanup endpoint.

## Required environment

- `NEXT_PUBLIC_APP_URL=https://rglrs.replit.app`
- `SESSION_SECRET` — use the existing production RGLRS secret through Replit Secrets. Never commit it.
- Optional: `CLEANUP_MAX_BATCHES` (defaults to `10`).

## Run

```bash
pnpm run media:cleanup
```

## Tests

```bash
pnpm test
```

## Replit deployment

Import this branch as a separate Replit app named `rglrs-media-cleanup-scheduler`, configure it as a **Scheduled Deployment**, use `pnpm run media:cleanup`, and schedule it every 15 minutes.

This scheduler does not need a public web URL and must not replace the main RGLRS Autoscale deployment.

Expected behavior:
- HTTP 409 cleanup-in-progress: successful no-op.
- Network/auth/unexpected HTTP errors: exit code 1.
- Cleanup-reported deletion failures: exit code 2.
