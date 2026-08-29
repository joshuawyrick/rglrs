---
name: Google Maps referrer smoke
description: How rotating Replit development origins affect restricted Google Maps browser-key validation.
---

Validate restricted Google Maps browser keys under the current browser-visible
document origin, not localhost and not a spoofed request header. Treat a rotated
Replit development domain as a new origin that must replace the stale Google
Cloud HTTP-referrer entry.

**Why:** Google Maps JavaScript authorization follows the page's real document
origin. A local release server can receive a rewritten request while Google still
rejects localhost or an older Replit preview domain.

**How to apply:** For release smoke checks, derive the active Replit development
origin from the environment, serve the isolated local build under that origin,
and keep the browser key restricted to the exact current development and
production referrers. Preserve authentication when crossing the local-to-browser
origin boundary without logging cookie or key values.