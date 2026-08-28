---
name: Production privacy test fixtures
description: Keep event-membership fixtures independent from friendship-revocation checks during production privacy validation.
---

Event privacy validation must enroll every disposable contributor before testing friendship removal or blocking; event membership and friendship eligibility are separate authorization dimensions.

**Why:** Removing a friendship before event setup can prevent the owner from adding the target member and produce an inconclusive event-exclusion result even when the feature works.

**How to apply:** Create and verify event membership first, then run friendship/feed revocation as a separate phase. If a fixture needs repair, change only disposable production rows and record the correction.