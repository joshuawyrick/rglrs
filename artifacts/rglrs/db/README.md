# Database migrations and privacy checks

Apply migrations to the connected Supabase project in numeric order:

1. `migrations/001_initial.sql`
2. `migrations/002_post_persistence.sql`
3. `migrations/003_saved_collections.sql`
4. `migrations/004_profile_username_collision.sql`
5. `migrations/005_account_safety.sql`
6. `migrations/006_private_media_lifecycle.sql`
7. `migrations/007_private_media_hardening.sql`
8. `migrations/008_media_completion_expiry.sql`
9. `migrations/009_immutable_media_promotion.sql`
10. `migrations/010_real_events_invites.sql`
11. `migrations/011_event_invite_pin_compatibility.sql`
12. `migrations/012_event_invite_pin_schema.sql`
13. `migrations/013_event_participation_approval_audit.sql`
14. `migrations/014_invite_decision_block_pin_hardening.sql`
15. `migrations/015_event_invite_lock_order.sql`
16. `migrations/016_real_communications_discovery.sql`
17. `migrations/017_communications_lifecycle_cursors.sql`
18. `migrations/018_post_locations.sql`
19. `migrations/019_profile_avatars.sql`
20. `migrations/020_founder_badges.sql`
21. `migrations/021_friend_network_feed_rpcs.sql`
22. `migrations/022_friend_network_realtime.sql`
23. `migrations/023_private_feed_invalidations.sql`
24. `migrations/024_feed_invalidation_cascade_safety.sql`
25. `migrations/025_event_media_privacy_downloads.sql`
26. `migrations/026_private_media_key_boundary.sql`
27. `migrations/027_message_media_key_boundary.sql`
28. `migrations/028_migration_state.sql`
29. `migrations/029_private_media_cleanup_lease.sql`
30. `migrations/030_published_media_recovery_hold.sql`
31. `migrations/031_place_autocomplete.sql`
32. `migrations/032_privacy_preferences.sql`
33. `migrations/033_event_cover_media.sql`
34. `migrations/034_signup_invites.sql`

The initial migration creates the relational/RLS foundation. The forward
migrations are safe to rerun and bring an existing beta project up to the
current persistence, account-safety, moderation, and abuse-control schema.

Migration 028 creates the authoritative `rglrs_migrations` ledger after checking
that the complete current schema is present. Apply it only after migrations
001–027. `pnpm --filter @workspace/rglrs run migrations:check` verifies that
repository files are contiguous and that the connected Supabase project has
the exact same ordered ledger. This check requires the server-only
`SUPABASE_ACCESS_TOKEN` and never prints its value.

Every migration after 028 must register its exact version and filename in
`public.rglrs_migrations` in the same transaction. Migration 029 demonstrates
that rule and adds the database lease that serializes scheduled cleanup across
autoscaled application instances.

Migration 030 keeps R2 objects released by deleted published posts stored for
30 days before cleanup. Unused draft uploads retain their existing expiration
and deletion behavior; no end-user restore capability is provided.

Migration 034 adds general member invitations and redemption audit records.
Only lowercase SHA-256 token digests enter SQL; plaintext tokens are returned
once by the creation route. Redeeming an invitation does not automatically
create a friendship—the recipient must explicitly choose Add inviter, which
uses the existing friendship RPC.

Migration 018 adds privacy-preserving post location labels. Locations remain
part of the post row, so the post's existing audience and RLS rules control
their visibility.

Migration 019 adds private profile-photo uploads. Avatar media is claimed by a
secure profile RPC and served only when the caller can read that profile.

Migration 020 adds the server-managed `profiles.is_founder` badge flag. It is
intentionally absent from the user profile update RPC.

Migration 025 adds contributor-owned event media exclusions and explicit,
default-off post download permission. Event exclusions never remove membership,
apply to the contributor's existing and future event posts, and are evaluated
by the same RLS helper used by feed, gallery, post detail, and media reads.

Migration 032 adds deny-wins account privacy choices in `privacy_settings`,
scoped templates in `privacy_default_audience_rules`, and nullable
per-person controls in `person_privacy_overrides`. Profile discovery and friend
requests use the same server-side decision helper. Post templates continue to
materialize through `audience_rules`, and event contributor choices continue to
use `event_media_exclusions`; neither mechanism is duplicated. Privacy RPCs
never read or expose `auth.users.email`.

Migration 026 removes table-wide browser SELECT access from `post_media` and
re-grants only its key-free metadata columns. Protected media routes use the
server-only service role to retrieve object keys after the caller's RLS
authorization succeeds.

Migration 027 applies the same key-free browser column boundary to
`message_media`. Authenticated participants retain attachment metadata access,
while protected message media routes resolve storage keys only through the
server-only service role.

Migration 010 makes friendships, circles, events, memberships, and invites
RPC-only for browser mutations. Invite tokens are supplied as hashes, PINs are
accepted only by the creation RPC and stored with bcrypt, and invite rows are
not directly readable by authenticated clients. `upload_only` redemption maps
to the existing `member` event role; `view_only` maps to `viewer`; `approval`
creates a pending `event_invite_redemptions` audit row without membership.
Callers should pass the lowercase SHA-256 hex digest of the random invite token
as `p_token_hash`; the plaintext token must never be persisted.

Migration 013 persists `event_members.participation_mode`, adds owner/admin
approval decisions and safe request listing, and records the deciding actor.
`participate` redeems as `member/participate`, `upload_only` as
`member/upload_only`, and `view_only` as `viewer/view_only`. Viewers cannot
create event posts; upload-only members must attach at least one validated
media upload. Event post association is derived from the single event audience.

Migration 014 revalidates and locks invitations when approval requests are
decided, removes the blocker from third-party shared events (or the non-owner
from owner/member blocks), and adds actor+invite PIN throttling at five attempts
per 15 minutes. Invite redemption now returns `NULL` for invalid, unavailable,
wrong-PIN, and throttled attempts so the private failure counter can commit.
API routes must treat a null RPC result as the same generic failed redemption
previously represented by an RPC error; they must not reveal which check failed.

Migration 015 uses one serialization order for event/invite workflows: lock the
event row, then the invite row, then the redemption row. Approval authorization
is re-read only after the event lock. Redeem, revoke, leave, and block-driven
membership changes use the same event-first order, with multi-event block
changes locking event UUIDs in sorted order. The SQL contract test asserts this
source order; Management API queries are single transaction requests and cannot
reliably coordinate two held sessions for a deterministic concurrency test.

Migration 016 makes conversations, messages, message media, and notifications
RPC-only. It adds canonical direct-message creation, plaintext message bodies,
idempotent client message IDs, participant-only pagination, read/unread state,
immutable upload claiming, fixed notification events with derived links, and
privacy-authorized people/event/post search. End-to-end encryption remains out
of scope for this release.

Migration 017 preserves shared conversations when their creator deletes their
account, removes a conversation only after its final membership disappears,
and cleans notifications when their polymorphic target is deleted. Read state
uses the exact `(created_at, id)` message cursor so equal timestamps cannot
skip unread messages. Notification links are canonical `/people/<uuid>`,
`/messages/<uuid>`, `/events/<uuid>`, and `/post/<uuid>` paths.

Run the non-destructive schema/RLS checks with:

```bash
pnpm --filter @workspace/rglrs run privacy:test
```

The tests use the Supabase Management API, run inside transactions, and always
roll back their test identities and content. They require
`NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_ACCESS_TOKEN` secrets.
Never expose that access token to browser code.