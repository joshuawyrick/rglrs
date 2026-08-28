# RGLRS media cleanup scheduler

This is a standalone, dependency-free Replit workspace for triggering the
existing RGLRS private-media cleanup endpoint. It does not contain Supabase or
Cloudflare credentials and does not duplicate media lifecycle or deletion
logic.

## Project identity

- Workspace/app name: `rglrs-media-cleanup-scheduler`
- Target production origin: `https://rglrs.replit.app`
- Scheduled Deployment command: `pnpm run media:cleanup`
- Schedule: every 15 minutes
- Public web URL: none; this is a command-only Scheduled Deployment

## Required runtime configuration

Set these in the scheduler app's production environment:

| Name | Type | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Environment variable | `https://rglrs.replit.app` |
| `SESSION_SECRET` | Replit Secret | The existing production RGLRS `SESSION_SECRET` |

`SESSION_SECRET` must be entered through Replit Secrets and must never be put
in this repository, a README, a command line, a log, or chat. The scheduler
validates that `NEXT_PUBLIC_APP_URL` is the exact production origin so it
cannot accidentally run against a preview or unrelated service.

`CLEANUP_MAX_BATCHES` is optional and defaults to `10`, matching the existing
RGLRS cleanup wrapper. Do not set it in the Scheduled Deployment unless a
different bounded batch limit is intentionally approved.

## Local checks

From this directory:

```bash
pnpm run check
pnpm test
```

The production invocation is:

```bash
pnpm run media:cleanup
```

It requires the two runtime values above. The command sends a server-only
`POST /private-media/cleanup` request with the bearer secret, follows the
endpoint's bounded `hasMore` batches, and treats HTTP `409` lease contention as
a successful no-op. It exits nonzero for missing configuration, network
failures, authentication failures, unexpected HTTP responses, malformed
responses, or cleanup failures reported by the endpoint.

## Import as a separate Replit app

1. Create a new Replit App from the contents of this folder, or import the
   folder as a new Node.js app named `rglrs-media-cleanup-scheduler`.
2. Keep the files at the new app's project root. Do not import the RGLRS
   application artifact, its workflows, or its deployment configuration.
3. Open the new app's Secrets/environment settings.
4. Set `NEXT_PUBLIC_APP_URL` to `https://rglrs.replit.app`.
5. Add `SESSION_SECRET` as a production Secret using the same value as the
   existing production RGLRS Secret. If Replit offers a secret attachment or
   sharing option, use that; otherwise enter the value directly in the
   Secrets UI. Never send it through chat or commit it.
6. Run `pnpm run check` and `pnpm test`.

## Publish only the scheduler

In the new scheduler app:

1. Open **Publishing**.
2. Choose **Adjust settings**.
3. Select deployment type **Scheduled**.
4. Set the run command to `pnpm run media:cleanup`.
5. Set the schedule to **every 15 minutes**.
6. Confirm the production environment includes
   `NEXT_PUBLIC_APP_URL=https://rglrs.replit.app` and the existing production
   `SESSION_SECRET` Secret.
7. Publish this new scheduler app only.

Scheduled Deployments do not serve a public page or require a public URL.
Replit automatically alerts when a Scheduled Deployment run fails, and the
nonzero exit status from this command makes request and cleanup failures
visible to that alerting system.

Do not open Publishing for the main RGLRS app or change its Autoscale
deployment settings.