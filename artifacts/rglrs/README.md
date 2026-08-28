# RGLRS v0.2.1

**Private social for the people who matter.**

RGLRS is a mobile-first private social network starter built to match the approved graphite + teal UI direction in `docs/mobile-ui-reference.png`.

## Visual source of truth

The 20-screen mobile board in `docs/mobile-ui-reference.png` is the V1 UI target. The codebase now includes matching routes for the primary flows rather than treating the board as a loose inspiration.

## Included screens / routes

1. Splash — `/welcome`
2. Login — `/login`
3. Home feed — `/`
4. Create post — `/create`
5. Audience picker — `/create/audience`
6. Events hub — `/events`
7. Event page — `/events/vegas-2026`
8. Event gallery — `/events/vegas-2026/gallery`
9. QR invite — `/events/emma-birthday/invite`
10. Invite accepted — `/invite/accepted`
11. Messages — `/messages`
12. Chat — `/messages/besties`
13. Profile — `/profile`
14. Notifications — `/notifications`
15. Settings — `/settings`
16. Search — `/search`
17. New event — `/events/new`
18. Event members — `/events/vegas-2026/members`
19. Post detail — `/post/p1`
20. PWA install guide — `/install`

## Stack

- Next.js 15
- React 19
- TypeScript
- Sora typography
- Supabase-ready auth/database layer
- PostgreSQL + RLS migration
- Cloudflare R2 signed-upload route
- QR invite generation
- General `/join` invitations with revocation, SVG/2048px PNG downloads, and explicit friend requests
- PWA manifest/service worker

## GitHub-first setup

Use GitHub as the source of truth, then import the repository into Replit.

Read:

- `SETUP_GUIDE.md` — complete account/key/setup walkthrough
- `REPLIT_MASTER_PROMPT.md` — exact Replit Agent prompt
- `REPLIT_SETUP.md` — quick Replit checklist

Run:

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --hostname 0.0.0.0
```

The app uses demo content until production services are connected.

## Design principles locked for V1

- Near-black graphite background
- Teal only for active states and primary actions
- Compact, native-feeling mobile spacing
- Chronological private feed
- Audience selection is part of composing a post
- Events are first-class private social spaces
- No public follower-count culture
- No permanent public media URLs in production

## Production next steps

1. Configure production Supabase and R2 variables separately from Preview.
2. Apply every numbered migration through `034_signup_invites.sql` in order.
3. Run `migrations:check`, `privacy:test`, and the published two-account pass.
4. Configure the scheduled private-media cleanup and verify backups/recovery.
5. Run device QA at 320px, 375px, 390px, 430px and tablet widths.
