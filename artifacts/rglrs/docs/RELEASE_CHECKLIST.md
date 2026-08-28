# RGLRS release checklist

Use this checklist for every beta release. Never paste secret values into logs,
source files, issues, or chat.

Release evidence must be stored as a credential-free record under
`docs/releases/`. The latest completed record is
`docs/releases/2026-08-28-beta-release.md`.

## 1. Data and integrations

- [ ] Apply every migration in numeric order, from
  `db/migrations/001_initial.sql` through
  `db/migrations/034_signup_invites.sql`; run the migration-state check and
  record the applied migration names and verify none were skipped.
- [ ] Run `pnpm --filter @workspace/rglrs run privacy:test`.
- [ ] Run `pnpm --filter @workspace/rglrs run migrations:check`.
- [ ] Confirm Supabase email authentication is enabled.
- [ ] Confirm the Cloudflare `rglrs-media` bucket exists and remains private.
- [ ] Confirm R2 CORS includes the exact development and production origins.
- [ ] Confirm all required application variables exist:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `NEXT_PUBLIC_APP_URL`, and a unique,
  randomly generated server-only `SESSION_SECRET`.
- [ ] Confirm the validation-only `SUPABASE_ACCESS_TOKEN` exists in the
  development/CI environment and is not configured as a browser/runtime value.
- [ ] Confirm the matching production variables are configured separately in
  Publishing.

## 2. Automated release gates

```bash
pnpm --filter @workspace/rglrs run release:check
```

- [ ] TypeScript passes.
- [ ] The optimized production build passes.
- [ ] Schema and RLS tests pass against the intended Supabase project.
- [ ] The gate starts an isolated production server and its route smoke checks
  pass.
- [ ] Public routes return successfully and signed-out access to private routes
  redirects to login.
- [ ] CSP, anti-framing, MIME, referrer, permissions, and production HSTS
  assertions pass.
- [ ] The service worker only caches immutable same-origin `/_next/static/`
  responses and never caches HTML, authenticated APIs, or private media.
- [ ] No secret value appears in build or test output.

## 3. Two-account privacy pass

Use two disposable accounts with no relationship unless the test requires one.
Follow `docs/TWO_ACCOUNT_RELEASE_TEST.md` and store only credential-free results.

- [ ] A signed-out visitor cannot open private routes or private media.
- [ ] An unrelated account cannot read another account’s private post, media,
  comments, saves, or collections.
- [ ] An authorized audience member can read the intended post and media.
- [ ] Removing audience access immediately removes post, media, and saved
  collection visibility.
- [ ] One account cannot update another account’s profile or create
  interactions on its behalf.
- [ ] Profile, request, and message person-denies override permissive defaults,
  and a saved post template applies only when the composer supplies no audience.

## 4. Operations and rollback

- [ ] Confirm a recent Supabase backup or point-in-time recovery option matches
  the beta risk level.
- [ ] Confirm Supabase PITR is enabled when the beta risk level requires it,
  record backup/PITR retention, and complete a restore drill. A backup list
  alone is not sufficient evidence of recoverability.
- [ ] Confirm the R2 bucket has an explicit retention/versioning policy beyond
  the default incomplete-multipart cleanup rule, and record its retention
  window.
- [ ] Complete or review the latest restore drill in `docs/BACKUP_RESTORE.md`;
  named database/storage owners and measured RPO/RTO are recorded privately.
- [ ] Record the migration files included in the release through
  `034_signup_invites.sql`.
- [ ] Confirm the previous working Replit checkpoint/deployment is available.
- [ ] Assign a primary and backup on-call owner for deployment logs. Confirm the
  platform log drain retains structured `errorId` records, alert thresholds are
  configured, and the owner can correlate a user-reported Error ID. No error
  event may include credentials, authorization headers, or request bodies.
- [ ] Use Autoscale rather than Static deployment.
- [ ] Schedule `pnpm --filter @workspace/rglrs run media:cleanup` every
  15 minutes with production-only secrets; alert on nonzero exits.

## 5. Post-publish verification

- [ ] Set `NEXT_PUBLIC_APP_URL` to the exact published/custom origin.
- [ ] Set Supabase Site URL and redirect URLs to the exact production origin.
- [ ] Add the exact production origin to R2 CORS.
- [ ] Run `SMOKE_BASE_URL=https://... pnpm --filter @workspace/rglrs run
  release:smoke` against the published URL.
- [ ] Verify Autoscale publishing uses the repository artifact
  `artifacts/rglrs`, build command `pnpm --filter @workspace/rglrs run build`,
  and run command `pnpm --filter @workspace/rglrs run start`.
- [ ] Repeat signup, login, logout, post creation, private-media access, save,
  collection, refresh, and cross-account privacy checks.

## Monitoring response runbook

RGLRS writes credential-free JSON error records to the deployment log stream.
Each record has `timestamp`, `event`, `errorId`, and exception fields. Framework
failure screens may expose a safe digest as the user-facing Error ID. The
release owner must maintain a named primary and backup responder and a private
escalation channel; “the engineering team” is not an owner.

1. A responder acknowledges the platform alert and opens an incident record.
2. Search retained deployment logs for the reported `errorId`, then correlate
   by UTC timestamp and `event`. Do not ask a user for cookies, tokens, or
   credentials.
3. Determine scope from event counts and safe dimensions. Never add request
   bodies, authorization headers, signed R2 URLs, or secret values to logs.
4. For privacy/authentication ambiguity, fail closed and escalate. Roll back to
   the previous verified deployment rather than disabling RLS or making R2
   public.
5. After mitigation, run published route smoke checks and the two-account
   privacy pass, record the resolution, and assign follow-up work.

Before launch, test this path with a deliberate non-production failure. Verify
the primary receives the alert, can find the Error ID within the retention
window, and can reach the backup owner. Store alert thresholds, retention
period, and escalation contacts in the private operations tracker because they
are deployment-specific.