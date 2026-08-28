---
name: Supabase extension schemas
description: Calling extension functions from hardened database functions.
---

SECURITY DEFINER functions with locked search paths must explicitly schema-qualify Supabase extension functions such as pgcrypto.

**Why:** This Supabase project installs pgcrypto under the `extensions` schema; unqualified calls fail when the function search path is intentionally restricted.

**How to apply:** Keep the search path narrow and call extension functions through their installed schema instead of broadening the search path.