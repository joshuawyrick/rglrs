---
name: Cleanup scheduler compatibility
description: Compatibility rule for command-only clients that invoke the production private-media cleanup endpoint.
---

External cleanup schedulers must accept the original successful response shape
containing `scanned`, `deleted`, and `failed`, as well as newer responses that
add staging counters and `hasMore`. Missing optional newer fields mean zero or
no additional batch; malformed required counters and every request, auth, HTTP,
or reported deletion failure must still fail the scheduled run.

**Why:** The published application can intentionally lag the repository during
a release hold, so a safe standalone scheduler may call an older but compatible
endpoint contract.

**How to apply:** Keep `scanned`, `deleted`, and `failed` required and validated;
treat newer staging counters and `hasMore` as optional compatibility fields.
Preserve safe lease-contention handling and nonzero exits for actual failures.