---
name: Realtime privacy revocation
description: How private client caches must react when a relationship or block change revokes access.
---

Private feeds must not rely only on local mutation events: friendship removal or blocking can happen in another tab, browser, or account session. Emit a dedicated per-user invalidation row that remains readable to its recipient after relationship access is revoked, publish that stream through the authenticated realtime channel, and retain conservative visible-tab polling as an outage fallback. Feed replacement must use a generation guard so an older in-flight pagination response cannot append content after access changes.

**Why:** RLS protects future reads but cannot retract private posts already rendered in a client. Same-tab events also miss changes performed by another participant or device.

**How to apply:** Any relationship or safety change that affects post visibility must trigger local and cross-session feed revalidation. Do not depend on the revoked relationship row itself being deliverable. Explicitly configure the invalidation table's publication and verify recipient-only RLS in database tests.