---
name: Private media key boundary
description: The durable split between browser-visible media metadata and server-only storage identifiers.
---

Browser roles may read the non-sensitive metadata needed to render authorized
media, but private storage object keys remain available only to a privileged
server path. A protected route must first authorize the media row using the
caller's session and only then resolve its storage key with a server credential.

**Why:** Row-level security controls which media rows a user may see, but a
table-wide read grant also exposes every selected column. Separating
authorization from key lookup provides defense in depth without duplicating
audience rules in application code.

**How to apply:** New browser media queries should use explicit key-free
projections. New media-serving routes should preserve user-session
authorization before any privileged lookup and must never include object keys
in browser responses.