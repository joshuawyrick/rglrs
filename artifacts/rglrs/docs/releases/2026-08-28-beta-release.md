# RGLRS beta release verification — 2026-08-28

This record contains credential-free evidence for the release completed on
2026-08-28. Named responders, escalation contacts, provider project references,
and recovery targets remain in the private operations tracker.

## Published build

- Source revision: `1aaeb3407a833130efc20c8a60b0bc61a1fdce79`
- Published origin: `https://rglrs.replit.app`
- Replit reported a successful, public Autoscale deployment after the workspace
  owner published the revision.
- Artifact: `artifacts/rglrs`
- Build command: `pnpm --filter @workspace/rglrs run build`
- Run command: `pnpm --filter @workspace/rglrs run start`
- Startup health path: `/welcome`

## Automated release gates

`pnpm --filter @workspace/rglrs run release:check` passed on the release
revision:

- TypeScript validation
- Optimized production build
- All eight Supabase schema/RLS privacy suites
- Event audience selection checks
- Bounded fallback-upload checks
- Immutable R2 promotion checks
- Isolated production-server route and security-header smoke checks

After publishing, the following command passed against the public origin:

```bash
SMOKE_BASE_URL=https://rglrs.replit.app \
  pnpm --filter @workspace/rglrs run release:smoke
```

Result: 33 public, protected, and protected-API routes passed, together with
CSP, anti-framing, MIME, referrer, permissions, HSTS, cache-control, and service
worker assertions.

## Two-account privacy evidence

The release gate executes transactional Supabase tests with separate owner,
authorized-viewer, and unrelated-account JWT identities. The tests roll back
their fixtures and passed against the configured Supabase project.

| Boundary | Evidence |
| --- | --- |
| Authorized audience can read a shared post and its media | `db/tests/core_privacy_rls.sql` |
| Unrelated account cannot read a private post, media, comments, reactions, saves, or collections | `db/tests/core_privacy_rls.sql` and `db/tests/saved_collections_rls.sql` |
| Removing audience access removes post, media, and saved-collection visibility | `db/tests/core_privacy_rls.sql` and `db/tests/saved_collections_rls.sql` |
| One account cannot update another profile or forge interactions | `db/tests/core_privacy_rls.sql` |
| Foreign circle/event audience rules are rejected | `db/tests/audience_rls.sql` |
| Blocked users cannot discover protected content or relay another owner’s media key | `db/tests/safety_rls.sql` |
| Private uploads require ownership and published media uses an immutable promoted key | `db/tests/private_media_lifecycle.sql` and `scripts/test-r2-immutable-promotion.mjs` |

Signed-out production checks also verified that every protected page redirects
to `/login`, protected account-data APIs return JSON `401` responses with
`Cache-Control: no-store`, and private routes are excluded from service-worker
caches.

## Production integrations

### Supabase

- Project status: healthy
- Email authentication: enabled
- Site URL: exact published origin
- Redirect allowlist: published origin, the active development origin, and
  localhost development
- Ordered migration set present in the release:
  `001_initial.sql` through `020_founder_badges.sql`
- The schema contract and all privacy suites passed against the configured
  project, including the columns and policies introduced by migrations 018–020.
- Latest managed backup reported `COMPLETED` at
  `2026-08-28T11:03:52.663Z`; two managed backup records were available.
- Automatic email confirmation remains enabled for the internal beta. Requiring
  verified email and production SMTP before external invitations is tracked
  separately.

### Cloudflare R2

- Bucket `rglrs-media` exists.
- The bucket has no custom domain.
- Its managed public `r2.dev` URL is disabled.
- CORS includes the exact published origin and the active development origins.
- Allowed methods are `GET`, `PUT`, and `HEAD`; allowed headers are limited to
  `Content-Type`, `x-amz-meta-owner`, and `x-amz-meta-upload-id`.
- The default incomplete multipart-upload abort rule is enabled.

## Operations and rollback

- The workspace owner confirmed that named primary and backup responders,
  alert thresholds and retention, escalation routing, backup/restore ownership,
  and measured RPO/RTO are recorded privately.
- Required development and production environment variables are configured;
  no secret values were printed or written to this record.
- The prior deployment and Replit checkpoints remain available for rollback.
- Post-publish runtime-log review found no new error records in the verification
  window.
