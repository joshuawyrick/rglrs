---
name: Migration ledger and cleanup lease
description: Durable release and cleanup invariants for RGLRS
---

RGLRS release validation treats migration filenames and the database ledger as
one ordered contract. New migrations must register their exact version and
filename in the same transaction, and the release gate must compare the
repository set with the live ledger.

**Why:** A passing application build does not prove a manually maintained
Supabase project received every privacy migration; autoscaled instances also
make process-local cleanup locks unsafe.

**How to apply:** Keep migration registration and schema-contract checks in
the release gate. Use a bounded batch cleanup command with a database-backed
lease, sanitized retry markers, and nonzero exit status when R2 deletion
failures remain.