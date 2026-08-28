---
name: Private R2 uploads in Preview
description: Why private R2 uploads keep an authenticated same-origin fallback in addition to signed direct PUTs.
---

Keep short-lived signed R2 PUTs as the primary upload path, but retain an
authenticated same-origin fallback bound to the same upload session, owner,
declared size, MIME type, and completion validation.

**Why:** Replit Preview hostnames can rotate independently of a bucket's CORS
allowlist. A valid signed PUT can therefore fail at browser preflight even when
production CORS is correct. The fallback prevents Preview-origin churn from
breaking uploads without weakening object ownership or validation.

**How to apply:** Any future upload refactor must preserve both paths or replace
them with another approach that is independent of rotating Preview origins.
Never respond by making the R2 bucket public or dropping signed metadata checks.