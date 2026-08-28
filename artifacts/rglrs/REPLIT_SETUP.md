# RGLRS v0.2.1 — Replit Quick Setup

This project is intended to be uploaded to **GitHub first**, then imported into Replit.

## Read these first

1. `SETUP_GUIDE.md` — full GitHub/Supabase/Cloudflare/Replit walkthrough
2. `REPLIT_MASTER_PROMPT.md` — exact prompt to paste into Replit Agent after import
3. `.env.example` — environment variable names only; never commit real values
4. `docs/mobile-ui-reference.png` — locked V1 visual target

## Local/Replit commands

```bash
npm install
npm run typecheck
npm run build
npm run dev -- --hostname 0.0.0.0
```

The UI renders in demo mode before Supabase and R2 are connected.

## Important

- GitHub is the source of truth.
- Replit is the preview/test/deploy environment.
- Do not let Replit Agent redesign the approved interface.
- Add API credentials only through Replit Secrets.
- Do not use Static Deployment; use Autoscale for the initial dynamic beta.
