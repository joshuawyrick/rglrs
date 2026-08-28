# RGLRS — GitHub → Supabase → Cloudflare R2 → Replit Setup Guide

This is the setup sequence for the RGLRS beta. Follow it in order.

## What you need

Create or use accounts for:
1. GitHub — source code / version history
2. Supabase — users, authentication, PostgreSQL database, Row Level Security, realtime later
3. Cloudflare — private R2 photo/video storage
4. Replit — preview, testing and deployment

You do **not** need Apple Sign In, Google Sign In, a custom domain, custom SMTP, or native app-store accounts just to get the first beta rendering and working. Add those after core email/password auth and privacy work are stable.

---

# PHASE 1 — PUT RGLRS ON GITHUB

## 1. Create the repository

1. Sign in to GitHub.
2. Select **New repository**.
3. Repository name: `rglrs-app` (recommended).
4. Set visibility to **Private**.
5. Do not add a README, .gitignore or license if GitHub asks — the project already contains these.
6. Create the repository.

## 2. Upload the project

1. Unzip the RGLRS package on your computer.
2. Open the unzipped `rglrs` folder.
3. In the empty GitHub repository, choose **Add file → Upload files**.
4. Upload the *contents* of the `rglrs` folder so `package.json` is at the repository root.
5. Commit with message: `Initial RGLRS v0.2.1 foundation`.

The repository root should contain folders such as `app`, `components`, `db`, `docs`, `lib`, `public`, plus `package.json`.

## 3. Security check before moving on

Confirm GitHub does **not** contain:
- `.env`
- `.env.local`
- API keys
- passwords
- Supabase secret keys
- Cloudflare access keys

The included `.gitignore` already ignores `.env` and `.env.local`.

---

# PHASE 2 — CREATE SUPABASE

## 1. Create the project

1. Sign in to Supabase.
2. Create a new project.
3. Name it `RGLRS`.
4. Choose a strong database password and save it in your password manager.
5. Choose a nearby region appropriate for the initial users.
6. Wait for the project to finish provisioning.

## 2. Get the values RGLRS needs

In the Supabase project, open the **Connect** dialog or **Settings → API Keys**.

Copy:
- **Project URL** → Replit secret `NEXT_PUBLIC_SUPABASE_URL`
- **Publishable key** (`sb_publishable_...`) → Replit secret `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

For the first beta, those are the only Supabase credentials the normal app needs.

There is also a server-side **Secret key** (`sb_secret_...`). Store it only as
`SUPABASE_SECRET_KEY`; private media routes use it after the caller passes RLS
authorization to resolve protected storage metadata. Never put it in browser
code.

## 3. Create the RGLRS database schema

1. In Supabase, open **SQL Editor**.
2. In GitHub, open each file in `db/migrations/` in numeric order, from
   `001_initial.sql` through the highest-numbered migration
   (`029_private_media_cleanup_lease.sql`).
3. Copy and run each complete SQL file before moving to the next one.
4. Do not skip the private-media lifecycle migration; uploads depend on its
   ownership, validation, and cleanup records.
5. After the final migration, run
   `pnpm --filter @workspace/rglrs run migrations:check` and
   `pnpm --filter @workspace/rglrs run privacy:test`.
6. Open **Table Editor** and confirm tables such as `profiles`, `friendships`, `circles`, `events`, `posts`, `messages`, `invites`, and `signup_invites` exist.

The migration also enables Row Level Security and installs the initial privacy policies. Do not disable RLS as a troubleshooting shortcut.

## 4. Authentication settings for initial development

For the first internal test, use email/password only.

Recommended development setup:
1. Open **Authentication → Sign In / Providers**.
2. Ensure Email is enabled.
3. While only you are testing, you may temporarily disable email confirmation to avoid needing production SMTP immediately.
4. Before inviting external beta users, turn email confirmation back on and configure a custom SMTP provider.

Do not set up Google or Apple login yet unless you specifically want to test those flows.

## 5. Supabase URL configuration

After Replit gives you a development URL:
1. Open **Authentication → URL Configuration**.
2. Add your Replit development URL as an allowed redirect URL.
3. Keep `http://localhost:3000/**` for local development if desired.
4. After publishing, set the production Site URL to the exact production URL/custom domain and add the production callback/redirect URLs.

Use exact production URLs rather than broad wildcards once the production domain is stable.

---

# PHASE 3 — CREATE CLOUDFLARE R2 STORAGE

## 1. Create the R2 bucket

1. Sign in to Cloudflare.
2. Open **Storage & databases → R2**.
3. Enable R2 if your account has not used it before.
4. Select **Create bucket**.
5. Bucket name: `rglrs-media`.
6. Create it.
7. Keep the bucket **private**. Do not enable public access.

## 2. Create R2 S3 credentials

1. In R2, open **Manage R2 API Tokens** / **API Tokens**.
2. Create an Account API token or User API token.
3. Permission: **Object Read & Write**.
4. Scope it to **only `rglrs-media`** if the dashboard allows.
5. Create the token.
6. Copy and save immediately:
   - **Access Key ID**
   - **Secret Access Key**
7. Copy your Cloudflare **Account ID** from the R2 overview/account details.

You will not be able to view the R2 Secret Access Key again after leaving the creation screen.

Map the values to Replit Secrets:
- Account ID → `R2_ACCOUNT_ID`
- Access Key ID → `R2_ACCESS_KEY_ID`
- Secret Access Key → `R2_SECRET_ACCESS_KEY`
- Bucket name → `R2_BUCKET` = `rglrs-media`

## 3. Configure R2 CORS

Browser uploads to presigned R2 URLs require CORS.

Once you know your Replit preview origin:
1. Open the `rglrs-media` bucket.
2. Open **Settings**.
3. Find **CORS Policy**.
4. Add a policy.
5. Use `cloudflare/r2-cors.example.json` as the template.
6. Replace `https://YOUR-REPLIT-DEV-DOMAIN` with your exact `https://...replit.dev` origin.
7. Replace `https://YOUR-PRODUCTION-DOMAIN` once you have a deployed/custom domain.
8. Save.

Do not make the bucket public to avoid CORS setup. Private storage is part of the RGLRS privacy design.
RGLRS keeps the signed R2 PUT as its primary upload path. If a rotating Preview
hostname has not propagated to CORS yet, the composer automatically retries the
same owner-bound upload session through an authenticated same-origin endpoint;
the completion route then promotes either staging upload to a distinct,
never-signed final key and validates that immutable final object.

RGLRS deliberately does not create public or persistent thumbnails. Photo and
video previews use the same protected media route as the original object, so a
thumbnail cannot outlive the post audience authorization. Uploaded drafts
expire and are removed by later upload requests; deleted posts release their
claimed objects into the same cleanup path. In production, schedule an
authenticated `POST /private-media/cleanup` every 15 minutes with
`Authorization: Bearer <SESSION_SECRET>` so cleanup continues during periods
without new uploads. Never expose that credential in browser code or logs.
Configure the scheduler to run
`pnpm --filter @workspace/rglrs run media:cleanup` with the production
`NEXT_PUBLIC_APP_URL` and `SESSION_SECRET`. The command drains bounded batches,
reports failures with a nonzero exit status, and exits safely when another
autoscaled instance already owns the cleanup lease.

---

# PHASE 4 — IMPORT GITHUB INTO REPLIT

## 1. Import

1. Sign in to Replit.
2. Open the import flow.
3. Choose **GitHub**.
4. Connect GitHub if prompted.
5. Select the private `rglrs-app` repository.
6. Import it.

Replit imports the repository files and dependencies, but secret values are not imported from GitHub.

## 2. Paste the master Agent prompt

Open `REPLIT_MASTER_PROMPT.md` in the repository.
Copy everything under the prompt section and paste it into Replit Agent.

The prompt intentionally tells Replit to inspect and validate the existing code rather than redesigning RGLRS.

## 3. Add Replit Secrets

In Replit:
1. Open **All tools → Secrets**.
2. Add the following App Secrets one at a time.

Required when Supabase/R2 are connected:

`NEXT_PUBLIC_SUPABASE_URL`

`NEXT_PUBLIC_APP_URL` — optional bare HTTPS canonical origin. If omitted,
external email, share, metadata, and QR URLs use `https://therglrs.com`.
Development links inside the app remain relative.

`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`R2_ACCOUNT_ID`

`R2_ACCESS_KEY_ID`

`R2_SECRET_ACCESS_KEY`

`R2_BUCKET` = `rglrs-media`

`SESSION_SECRET`

`SUPABASE_SECRET_KEY`

For `NEXT_PUBLIC_APP_URL`, use the current Replit preview URL during development. Change it to the published/custom domain for production.
Generate `SESSION_SECRET` independently in each environment (for example,
`openssl rand -base64 48`). It is server-only and authorizes the scheduled
private-media cleanup request; never expose it to browser code or reuse it
between development and production.

Do not paste secret values into Agent chat. Put them only in the Secrets tool.

For release validation only, configure the server-only
`SUPABASE_ACCESS_TOKEN` in the development/CI environment. It is a Supabase
Management API token used by migration and privacy checks, not an application
runtime credential and never a browser variable.

## 4. Run the app

Replit/Agent should run:

```bash
pnpm install
pnpm --filter @workspace/rglrs run typecheck
pnpm --filter @workspace/rglrs run build
pnpm --filter @workspace/rglrs run dev
```

The app should still render in demo mode even before Supabase and R2 are fully wired.

## 5. Visual QA

Compare the app to:

`docs/mobile-ui-reference.png`

Check these routes first:
- `/welcome`
- `/login`
- `/`
- `/create`
- `/create/audience`
- `/events`
- `/events/vegas-2026`
- `/events/vegas-2026/gallery`
- `/events/emma-birthday/invite`
- `/messages`
- `/messages/besties`
- `/profile`
- `/notifications`
- `/settings`
- `/search`
- `/install`

Check phone widths around 320, 375, 390 and 430 pixels.

---

# PHASE 5 — FIRST FUNCTIONAL BACKEND PASS

Once Preview renders correctly, have us wire functionality in this order:

1. Supabase signup/login/logout/session
2. profile onboarding
3. friend requests and circles
4. create post
5. audience rule persistence
6. private feed query
7. R2 upload URL flow
8. photo/video post media
9. events and event memberships
10. QR invitation generation/redemption
11. comments/reactions/notifications
12. real messaging
13. automated RLS/privacy tests

Do not try to wire everything in one Agent request.

---

# PHASE 6 — PUBLISHING

For the initial RGLRS beta:
1. Use Replit **Autoscale** publishing, not Static publishing.
2. Verify the published app works on the Replit URL first.
3. Configure production secrets in the Publishing pane as required — do not assume editor Secrets automatically carry over.
4. Update `NEXT_PUBLIC_APP_URL` to the production URL.
5. Update Supabase Site URL/redirect URLs.
6. Add the production origin to R2 CORS.
7. Republish and test signup, login, uploads and private content with at least two separate test accounts.

Later, connect a custom RGLRS domain.

---

# PHASE 7 — BEFORE EXTERNAL BETA USERS

Before inviting real users, complete these items:
- configure custom SMTP for Supabase Auth
- re-enable/confirm email verification
- privacy and terms pages
- report/block flows
- upload size/type validation
- automated authorization tests
- test unauthorized access with a second account
- backups/production Supabase plan decision
- error monitoring
- rate limiting / abuse controls
- final custom domain + auth redirect configuration

For every beta release, follow `docs/RELEASE_CHECKLIST.md`. The repeatable
release gate is:

```bash
pnpm --filter @workspace/rglrs run release:check
```

RGLRS emits structured server error records with an `errorId` to the deployment
logs and shows safe framework error IDs on failure screens. Before launch,
assign primary and backup owners for those logs, configure the platform log
drain/retention and alerts, and test that support can correlate an Error ID.
This is integration-ready and does not require adding a credentialed
third-party monitoring vendor. Follow `docs/BACKUP_RESTORE.md` for backup and
restore ownership and drills.

---

# KEYS / VALUES CHEAT SHEET

## Required for first real backend connection

| Replit Secret | Where it comes from | Safe in browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase API Keys | Yes, designed to be public with RLS |
| `R2_ACCOUNT_ID` | Cloudflare account/R2 overview | Server env only |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 API token | No |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 API token | **No** |
| `R2_BUCKET` | Your bucket name | Not sensitive |
| `NEXT_PUBLIC_APP_URL` | Replit/custom app URL | Yes |
| `SESSION_SECRET` | independently generated scheduled-cleanup bearer secret | **No** |

## Optional later

| Replit Secret | Purpose |
|---|---|
| `SUPABASE_SECRET_KEY` | privileged server/admin jobs; bypasses RLS, so protect carefully |

Never commit real values to GitHub.
