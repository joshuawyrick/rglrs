# RGLRS

A mobile-first private social network for sharing posts, events, messages, and invitations with trusted friends and circles.

## Run & Operate

- `pnpm --filter @workspace/rglrs run dev` — run the Next.js app through its managed workflow
- `pnpm --filter @workspace/rglrs run typecheck` — check the RGLRS app
- `pnpm --filter @workspace/rglrs run build` — create the production Next.js build
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- Demo mode requires no external credentials.
- Supabase/R2 variables are documented in `artifacts/rglrs/.env.example`.

## Stack

- Next.js 15, React 19, TypeScript
- Supabase-ready authentication and PostgreSQL/RLS schema
- Private Cloudflare R2 signed-upload route
- PWA manifest and service worker

## Where things live

- App routes: `artifacts/rglrs/app`
- Shared UI: `artifacts/rglrs/components`
- Demo data: `artifacts/rglrs/lib/demo-data.ts`
- Database migration: `artifacts/rglrs/db/migrations/001_initial.sql`
- Approved visual reference: `artifacts/rglrs/docs/mobile-ui-reference.png`

## Architecture decisions

- Preserve the imported Next.js application and its existing folder structure.
- Treat the 20-screen mobile reference as the visual specification, not loose inspiration.
- Keep demo mode operational until Supabase and R2 are configured incrementally.
- Keep the R2 bucket private and use authorized, expiring media access.

## Product

The demo includes onboarding, login/signup, a private feed, audience selection, events and invitations, messaging, profile, notifications, settings, search, post detail, and PWA installation guidance.

## User preferences

- Do not redesign the approved graphite, slate, teal, and white mobile interface.
- Do not replace the logo or convert the app into a generic template.

## Gotchas

- The app must listen on the workflow-provided `PORT` and on `0.0.0.0`.
- Use Replit Secrets for credentials; never commit real values.
- Preserve Row Level Security and fail closed for private data.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
