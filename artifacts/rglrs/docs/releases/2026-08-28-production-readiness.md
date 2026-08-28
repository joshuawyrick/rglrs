# RGLRS production-readiness evidence — 2026-08-28

## Published release

- Origin: `https://rglrs.replit.app`
- Deployment type: Autoscale
- Published revision: `c2a35e57c8643ec8182855ef8c250d99aa847aab`
- Verification window: 2026-08-28 20:11–20:36 UTC
- Deployment metadata reported a successful public build at the exact origin.

## Approved beta recovery policy

- Supabase daily backups with seven-day retention are the approved beta
  database recovery policy.
- PITR is intentionally deferred and is not a beta release blocker.
- Published media uses the application-level 30-day soft-delete recovery
  period implemented by migration 030.
- Cloudflare Bucket Lock and object versioning are intentionally deferred and
  are not beta release blockers.
- The separate production media-cleanup scheduler is active every 15 minutes,
  as confirmed by the release owner. A production cleanup invocation during
  verification completed with zero staging or published-media failures.

## Published-origin verification

- The 33-route security/PWA smoke suite passed against the published origin.
- TypeScript passed.
- The live migration ledger is contiguous through
  `030_published_media_recovery_hold.sql`.
- The Supabase schema and privacy suite passed, including friendship, feed
  revocation, event-media privacy, communications boundaries, private-media
  lifecycle, and storage-key boundaries.
- Three disposable confirmed accounts completed the production browser checks.
- Authentication sessions survived reload and signed-out sessions returned to
  the published login origin.
- Friendship removal and blocking revoked the already-visible friends-only
  post, permalink, media, and download route.
- Event contributor exclusions hid only the selected contributor’s existing
  event media, preserved the excluded member’s membership and the other
  contributor’s media, and restored visibility when removed.
- Removing a post from an event removed it from member feeds while retaining it
  privately for its author.
- Authorized private-media downloads returned the expected image response.
  Disabled downloads failed closed while post access remained; re-enabling
  restored the download; audience revocation then denied both post and download
  access.
- A message attachment was visible to both conversation participants and
  unavailable to an unrelated authenticated account.
- Published post, event, and message payload/resource inspection exposed no R2
  object keys, permanent bucket URLs, signed storage URLs, or storage
  credentials.
- Deleting a published post immediately removed its user-facing row and moved
  its upload to the recoverable state with an expiry exactly 30 days after the
  deletion update.

## Cleanup evidence

- All disposable posts, event records, memberships, friendships, blocks,
  conversations, messages, media relationships, profiles, and auth accounts
  were removed.
- Four disposable published-media objects and one stale staging object were
  removed through the authenticated production cleanup endpoint with zero
  failures.
- Direct object checks confirmed the four disposable final objects no longer
  existed.
- Final database checks found no remaining rows owned by the disposable
  accounts or tagged with the release-test prefix.

## Release decision

The published revision passed the required security, privacy, media,
authorization, recovery-policy, and cleanup checks. No actual beta release
blockers remain under the approved recovery policy.