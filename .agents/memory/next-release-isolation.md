---
name: Next.js release validation isolation
description: Why RGLRS release checks isolate production builds from the running Preview.
---

Run production release validation in an isolated Next.js distribution directory,
and restore any Next-generated TypeScript config files after the check.

**Why:** A concurrent production build can delete or replace files used by a
running `next dev` process, producing missing chunk/type errors and invalid smoke
results. Also, `NEXT_PUBLIC_*` values used by middleware are embedded at build
time, so a missing-configuration test must omit them during the build, not only
when starting the server.

**How to apply:** Any automated RGLRS release check that runs while Preview may
be active should build and start the same isolated output, run smoke checks
against that server, terminate it, and clean up without touching Preview’s
`.next` directory.