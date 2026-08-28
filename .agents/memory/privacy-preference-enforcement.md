---
name: Privacy preference enforcement
description: Why persisted privacy controls must govern server-side creation and protected media delivery.
---

Privacy defaults must be applied atomically by the server when a user leaves a
composer control untouched. Explicit user choices remain authoritative, but a
client-side prefill is not a substitute for server-side default resolution.
Person-specific media denials must also be checked at the protected delivery
route, not only when deciding whether a post or profile row is visible. Every
setting exposed in the product must also have a complete configuration path:
subject-based defaults need subject management, and person overrides need an
add/edit/remove flow for every advertised field.

**Why:** An asynchronous prefill can race submission, and row visibility alone
does not enforce narrower download or profile-photo controls. Persisting a
setting without wiring it into the final authorization boundary creates a
misleading privacy control.

**How to apply:** Preserve absent/untouched values through the client and RPC
boundary so the server can resolve current defaults. At every protected media
route, combine content visibility with the relevant person-specific privacy
helper before resolving or streaming storage content. Test every selectable
default with valid subjects and verify denied interaction policies at the
creation RPC, not only at later message or content access.