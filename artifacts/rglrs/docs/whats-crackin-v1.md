# What's Crackin V1 rollout

This branch adds the PWA-first What's Crackin location/discovery experience and replaces the event date inputs with one mobile date-range calendar.

## Runtime behavior

- Location sharing is always opt-in.
- PWA location updates are foreground/current-use only. The UI never promises native-style background tracking.
- Positions updated in the last five minutes are labeled **Live**. Older authorized positions are labeled **Last check-in** and disappear after the user's selected TTL (0, 30 minutes, 2 hours, or 8 hours).
- Audiences: friends, selected friends, one event, everyone signed in to RGLRS, or anonymous nearby.
- Anonymous sharing always uses approximate location and returns no user id, name, username, or avatar.
- Approximate positions are shifted on the server before being returned. Raw coordinates remain in `private.current_locations` and are not client-readable.
- Blocks and `can_view_location=false` person overrides always deny location access.
- Event-scoped sharing requires event membership and cannot extend past the event end when an end time exists.
- Stopping sharing immediately deletes the current exact-position row.

## Database rollout order

**Apply migrations 035, 036, 037, and 038 before publishing the application code.**

The existing `/private-media/cleanup` maintenance endpoint now also calls `prune_expired_locations_secure`. Publishing that route before migration 037 would cause the scheduled maintenance run to fail. No new scheduler deployment is required; the existing 15-minute scheduler can continue calling the same endpoint after the migrations are present.

Migrations:

1. `035_whats_crackin_location.sql` — PostGIS, sharing sessions, private exact positions, secure nearby/location RPCs.
2. `036_location_privacy_override_compat.sql` — preserves location overrides through existing privacy-save paths.
3. `037_whats_crackin_retention_hardening.sql` — username-discovery enforcement and service-only location pruning.
4. `038_location_discovery_safety.sql` — deny-by-default public/anonymous discovery until a server-managed age/family-safety eligibility policy is available.

Do not edit historical migrations.

## Google Maps configuration

What's Crackin loads the Maps JavaScript API using `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.

This is intentionally a browser-visible Google key. In Google Cloud, restrict it to:

- Maps JavaScript API only.
- HTTP referrers exactly to the approved origins below (Google Cloud referrer patterns include `/*`):
  - Development: `https://59204ef6-03f6-42fe-8123-2c15b21d523d-00-1efpiyhwk7lgs-jij312pw.picard.replit.dev/*`
  - Production: `https://therglrs.com/*`
- Do not add the server/API key, wildcard hosts, or unapproved aliases such as `https://rglrs.replit.app/*`.

Keep the existing `GOOGLE_PLACES_API_KEY` server-only for Places autocomplete.

The loader removes a failed script before clearing its shared promise, so a transient
network or Google Maps initialization failure can be retried by returning to the Map tab.
Near You remains available when the live map is unavailable.

## Release validation

Before production:

1. Apply 035–038 to a development/staging Supabase project.
2. Run `pnpm typecheck` and `pnpm build`.
3. Run `pnpm privacy:test`; it now includes `whats_crackin_privacy.sql` and `whats_crackin_retention.sql`.
4. Test event range selection at 320, 375, 390, and 430px widths, including same-day and cross-month ranges.
5. Test What's Crackin with at least three accounts: friend, stranger, and blocked/denied viewer.
6. Verify public/anonymous viewers never receive raw coordinates or private identity fields.
7. Verify a foregrounded PWA updates location and a backgrounded/closed PWA ages into Last check-in rather than appearing Live.
8. Verify stopping sharing removes the pin immediately.
9. Verify the existing cleanup scheduler still exits 0 and reports `locationRowsPruned` after migrations are applied.
10. Run the existing full release gate.

Public and anonymous discovery options are intentionally hidden unless the server reports
an eligibility record. Unknown-age accounts cannot enable these modes through the UI or
direct RPC calls.

## Minor/public-discovery safety

The current account model does not expose a reliable age gate to this feature. Migration 038 therefore fails closed: public and anonymous location discovery remain unavailable unless a server-managed eligibility record explicitly allows the account. Friends, selected-friend, and event sharing remain available under the same deny-first privacy model.

## Production status

This branch changes source code only. The migrations, Google Maps browser key, DNS, Supabase production state, Replit deployment, and production application are intentionally unchanged until an explicit release approval.
