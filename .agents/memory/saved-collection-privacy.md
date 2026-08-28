---
name: Saved collection privacy
description: Privacy and lifecycle invariants for saved-post collection membership.
---

Collection membership reads and counts must require collection ownership, an active save by that owner, and current permission to view the post. Removing a save must remove that owner’s collection memberships in the same database transaction.

**Why:** Owner-only collection access is not enough: stale membership rows can leak inaccessible post IDs through counts or metadata, and unsaving can otherwise leave posts visible in collection views.

**How to apply:** Any new collection query, count, export, or mutation path must preserve both the post-audience check and the save-membership lifecycle rather than relying only on client-side filtering.