# RGLRS — Master Replit Agent Prompt

Paste the prompt below into Replit Agent immediately after importing the GitHub repository.

---

You are working on an EXISTING application named RGLRS. Do not recreate it from scratch.

RGLRS is a mobile-first private social network. The approved visual source of truth is:

`docs/mobile-ui-reference.png`

The current stack is Next.js 15, React 19, TypeScript, Supabase, PostgreSQL/RLS, Cloudflare R2, and a PWA layer.

## NON-NEGOTIABLE VISUAL RULES

Preserve the approved RGLRS appearance:
- near-black graphite background
- dark slate cards/surfaces
- restrained bright teal accent
- white primary typography and muted gray secondary typography
- Sora-style typography direction
- compact iPhone-native spacing
- rounded dark cards and controls
- story/circle avatars at the top of the feed
- teal only for primary actions, active states, selected privacy states, and small highlights
- do not convert this into a generic shadcn/Tailwind template
- do not switch to a light theme
- do not redesign the logo
- do not replace the approved mobile UI with your own design interpretation

The 20-screen reference is the target. Treat it as a specification, not inspiration.

## SOURCE-CONTROL RULES

This GitHub repository is the source of truth.
- Preserve the existing folder structure unless a concrete technical issue requires a change.
- Make small, reviewable changes.
- Before changing architecture, explain why and ask for approval.
- Do not delete existing routes or the demo UI.
- Do not overwrite documentation files or design references.
- Do not commit secrets, `.env`, `.env.local`, API keys, tokens, passwords, or credentials.

## FIRST TASK: INSPECT, DO NOT REDESIGN

Before modifying code:
1. Read `README.md`.
2. Read `SETUP_GUIDE.md`.
3. Read `REPLIT_SETUP.md`.
4. Read `.env.example`.
5. Inspect `package.json` and `.replit`.
6. Inspect `db/migrations/001_initial.sql`.
7. Inspect the existing routes under `/app`.
8. Inspect `docs/mobile-ui-reference.png`.

Then report:
- detected framework/version
- install command
- development run command
- build command
- which environment variables are currently missing
- any actual compile/runtime issues you detect

Do not begin a redesign.

## RUN / VERIFY

Run these in order:
1. `npm install`
2. `npm run typecheck`
3. `npm run build`
4. `npm run dev -- --hostname 0.0.0.0`

If any command fails:
- diagnose the concrete error
- make the smallest safe fix
- rerun the failed command
- tell me exactly which files changed and why

Do not upgrade major framework versions just to fix an error unless absolutely required and approved.

## ENVIRONMENT VARIABLES

Use Replit Secrets. Never hard-code values.

Required once services are connected:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `NEXT_PUBLIC_APP_URL`

Optional later, server-only:
- `SUPABASE_SECRET_KEY`

If a required variable is missing, DO NOT invent a value and DO NOT create fake credentials. Tell me exactly which service I must open, what page I must visit, and what value I should copy into Replit Secrets.

Never print secret values into console output or source files.

## SUPABASE RULES

- Use the current Supabase publishable key for browser/user-session clients.
- Never expose a Supabase secret key to client code.
- Preserve and enforce Row Level Security.
- Do not bypass RLS to make development easier.
- Do not weaken privacy policies just to make a query work.
- If a query fails because of RLS, diagnose the policy and propose the minimum correct policy change.
- The app must fail CLOSED on privacy checks: unauthorized users should not receive private post/event/message/media data.

## CLOUDFLARE R2 RULES

- R2 bucket must remain private.
- Never make the media bucket public as a shortcut.
- Uploads should use short-lived presigned URLs.
- Do not expose R2 credentials to the browser.
- Respect the CORS configuration documented in `SETUP_GUIDE.md`.
- Production media viewing should use authorized, expiring access rather than permanent public object URLs.

## DEMO MODE

The existing UI can render with demo data before Supabase/R2 are connected. Preserve that behavior while infrastructure is being configured.

Once Supabase is connected, migrate features incrementally rather than breaking the whole demo UI at once.

Recommended order:
1. real signup/login/session handling
2. profiles
3. friends/circles
4. post creation + audience rules
5. private feed queries
6. R2 photo uploads
7. events and membership
8. event QR invites
9. comments/reactions/notifications
10. messaging
11. production privacy tests

## ROUTES THAT MUST RENDER

Verify at minimum:
- `/welcome`
- `/login`
- `/signup`
- `/`
- `/create`
- `/create/audience`
- `/events`
- `/events/vegas-2026`
- `/events/vegas-2026/gallery`
- `/events/emma-birthday/invite`
- `/invite/accepted`
- `/messages`
- `/messages/besties`
- `/profile`
- `/notifications`
- `/settings`
- `/search`
- `/events/new`
- `/events/vegas-2026/members`
- `/post/p1`
- `/install`

Test at mobile viewport widths of approximately 320, 375, 390, and 430 CSS pixels. There must be no page-level horizontal overflow.

## PUBLISHING

This is a dynamic Next.js application. Do not configure it as a Static Deployment.
Use an Autoscale deployment for the initial beta unless I explicitly choose another deployment type.
The app server must listen on `0.0.0.0`.

When we publish, remind me that Replit production/publishing secrets may need to be configured separately from editor secrets.

## DEFINITION OF DONE FOR THIS FIRST REPLIT PASS

Do not add random new features. The first pass is complete when:
- dependencies install
- TypeScript passes
- production build passes
- app runs in Replit Preview
- all core demo routes render
- the mobile UI still closely matches `docs/mobile-ui-reference.png`
- missing external credentials are clearly listed
- no credentials are committed to GitHub
- you provide a concise change log

Start by inspecting the existing project and reporting what you find. Do not redesign it.

---
