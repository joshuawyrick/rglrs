---
name: Artifact route ownership
description: Route-prefix and public-link constraints in a multi-artifact Replit workspace.
---

Do not place RGLRS handlers beneath a prefix assigned to a sibling artifact. Server-generated request origins may also be internal addresses, so bearer share links should be returned as relative paths and resolved against the browser-visible origin.

**Why:** A sibling API artifact intercepted RGLRS handlers, and the Next server observed an internal origin that was unsuitable for shared links.

**How to apply:** Check artifact route ownership before adding handlers. For user-shareable links, return a relative path from the server and construct the absolute URL in the browser.