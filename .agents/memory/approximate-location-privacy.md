---
name: Approximate location privacy
description: Rules for preventing nearby-query probing from reconstructing an exact private location.
---

Approximate-location output must use a stable offset derived from non-public entropy, and every radius or distance decision exposed to the viewer must use the shifted display point rather than the raw stored point. Internal authorization predicates must not be directly executable by client roles.

**Why:** A deterministic offset built from returned identifiers can be inverted. Even with a secret offset, filtering eligibility against the raw point lets repeated radius probes reconstruct the true position.

**How to apply:** For any nearby/map discovery feature, keep raw coordinates in a client-inaccessible schema, project once with server-only entropy, and perform viewer-visible inclusion, ordering, and distance calculations against that projected point.