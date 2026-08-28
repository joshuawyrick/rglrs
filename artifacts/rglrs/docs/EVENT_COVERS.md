# Event covers

Event covers use the same immutable private-media promotion flow as post media and profile photos. Browsers upload only to a short-lived draft key; the server validates and promotes the object before an event RPC can claim its upload ID.

- Create and update RPCs claim, replace, or clear a cover in the event transaction.
- Replaced, cleared, and event-deleted covers return to `uploaded` with a 30-day recovery hold before cleanup.
- Cover object keys remain service-only. Authenticated event members read covers through `/private-media/event-cover/:eventId`, which authorizes with event RLS before looking up the object.
- Covers accept validated JPG, PNG, or WebP images up to 15 MB.
- Legacy event RPC signatures remain granted for older clients; the event form uses the extended overloads with all-day, IANA timezone, and cover fields.

The focused database regression is `db/tests/event_cover_lifecycle.sql`.