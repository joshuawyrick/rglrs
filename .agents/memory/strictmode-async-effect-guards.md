---
name: StrictMode async effect guards
description: Avoid request-deduplication guards that suppress React StrictMode's second effect run.
---

Do not set a persistent “already loaded” ref before an async effect has completed successfully when the effect cleanup invalidates its response.

**Why:** In React development StrictMode, the first effect run is cleaned up and replayed. A ref set by the cancelled first run can suppress the second run, leaving the UI unhydrated even though the request returned successfully.

**How to apply:** Let idempotent reads replay, use an abort controller per run, or only commit deduplication state after a live run applies its result.