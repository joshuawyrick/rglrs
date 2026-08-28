---
name: Immutable media promotion
description: Why published private media must use a distinct final R2 key that was never directly signed.
---

Browser uploads must target a staging key. The server must reserve promotion,
copy to a distinct final key, validate the final object, and allow posts to
claim only that final key.

**Why:** A presigned PUT remains usable until its expiration even after the
first upload completes. Validating and publishing that same key leaves a window
where the client can overwrite already-validated media.

**How to apply:** Never issue a browser write capability for a key referenced by
published content. Late writes to staging must be harmless, and expired staging
keys must remain covered by cleanup and account-prefix deletion.