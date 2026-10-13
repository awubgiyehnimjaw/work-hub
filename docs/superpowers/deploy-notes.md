# Work Hub — deployment notes

One-time setup for the real, live deployment of Work Hub. This is **not**
needed to develop the app locally — `npm run dev` works out of the box with
no env vars at all (`lib/db/client.ts` falls back to a file-backed local
Postgres under `.data/dev-db` whenever `DATABASE_URL` is unset outside
production). These notes are only for standing up the actual production
deployment Callum uses day to day.

Follow the sections in order: they build on each other (you need the
Vercel domain before you can register OAuth redirect URIs, you need
`DATABASE_URL` before you can run migrations, etc).

## 0. The one hard requirement: `DATABASE_URL`

**`DATABASE_URL` must be set on the real Vercel deployment. There is no
working fallback in production.**

`lib/db/client.ts` deliberately fails loudly — throws `"DATABASE_URL is
not set"` on the very first database access — if the app is running with
`NODE_ENV=production` (which Vercel always sets) and `DATABASE_URL` is
missing. Older behavior would have silently used the same throwaway
local/in-memory database `next dev` uses, which would appear to work while
quietly losing every piece of data on the next deploy or restart. That
fallback is intentionally *not* available in production. If you ever see
this error in Vercel's logs, it means `DATABASE_URL` is missing or was
dropped from the deployed environment — go set it (see §1.1) and redeploy.

This is the one env var that is not optional, not best-effort, and not
something to postpone. Everything else below is still required for a
fully working deployment, but this one fails hard and immediately, by
design.

## 1. Deploy to Vercel

1. Push this repo to GitHub (if not already there) and import it into
   Vercel ([vercel.com/new](https://vercel.com/new)). Framework preset
   "Next.js" is auto-detected; no build command overrides are needed.
2. Do the first deploy before setting every env var below — Vercel will
   build, and some routes will fail at request time until the env vars
   are in place. That's expected; redeploy once they're all set (§5).
3. Note the production domain Vercel gives you (e.g.
   `https://work-hub.vercel.app`, or a custom domain if you attach one).
   You'll need it for the OAuth redirect URIs (§3) and the GitHub Actions
   secret (§6).

### 1.1 Provision the Neon database

1. Create a project at [neon.tech](https://neon.tech) (free tier is
   enough).
2. In the Neon console, copy the **pooled** connection string (the
   "Connection string" panel → "Pooled connection" — this project's
   `lib/db/client.ts` talks to Neon over HTTP via
   `@neondatabase/serverless`, which expects the pooled endpoint).
3. That connection string is `DATABASE_URL`.

## 2. Env vars

Set all of these in Vercel → Project Settings → Environment Variables
(Production environment at minimum). This list is exactly the set of
vars in `.env.example` — if a future change adds one there, add it here
too.

| Var | Where it comes from |
| --- | --- |
| `DATABASE_URL` | The Neon pooled connection string from §1.1. **Mandatory in production — see §0.** |
| `SESSION_SECRET` | Any long random string. Signs the passcode session cookie (`lib/auth/session.ts`). Generate one with `openssl rand -hex 32`. |
| `WORK_HUB_PASSCODE_HASH` | A bcrypt hash of the single passcode Callum will type at `/login` — **not** the raw passcode. Generate it by running, from the project root, `node -e "console.log(require('bcryptjs').hashSync('YOUR-PASSCODE-HERE', 10))"` (uses the `bcryptjs` dependency already in `package.json`) and pasting the printed hash. |
| `CRON_SECRET` | Any long random string (e.g. `openssl rand -hex 32`). Gates `/api/cron/*` (`lib/auth/cron-secret.ts`). Must be set to the **exact same value** as the `CRON_SECRET` GitHub Actions secret in §6 — the GitHub Actions workflow sends this as a bearer token and Vercel checks it against this env var. |
| `VAPID_PUBLIC_KEY` | Generate a VAPID key pair with `npx web-push generate-vapid-keys` (uses the `web-push` dependency already in `package.json`). Use the printed public key here. |
| `VAPID_PRIVATE_KEY` | The private key from the same `web-push generate-vapid-keys` run. Server-side only — never expose this one under a `NEXT_PUBLIC_` name. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The **same value** as `VAPID_PUBLIC_KEY`, just also set under this `NEXT_PUBLIC_`-prefixed name so the browser-side `EnableNotificationsButton` component can read it for `pushManager.subscribe({ applicationServerKey })`. |
| `FRAMEIO_CLIENT_ID` | The Client ID of an Adobe Developer Console OAuth integration for Frame.io — see §3.1. |
| `FRAMEIO_CLIENT_SECRET` | The Client Secret from that same Adobe Developer Console integration. |
| `FRAMEIO_PROJECT_ID` | The Frame.io project Callum's editor delivers cuts into. Visible in the project's URL when viewing it at [app.frame.io](https://app.frame.io), or via the Frame.io V4 API's project list. |
| `FRAMEIO_ACCOUNT_ID` | The Frame.io account that project belongs to (used to build the V4 API path `/v4/accounts/{FRAMEIO_ACCOUNT_ID}/...` in `lib/frameio/client.ts`). Same source as `FRAMEIO_PROJECT_ID` — visible in the account's URL/settings in the Frame.io web app, or via the V4 API. |
| `GOOGLE_CLIENT_ID` | The Client ID of a Google Cloud Console OAuth 2.0 Client (type "Web application") — see §3.2. |
| `GOOGLE_CLIENT_SECRET` | The Client Secret from that same Google Cloud Console OAuth client. |

After setting these, trigger a redeploy (Vercel → Deployments → ⋯ →
Redeploy) — env var changes don't apply retroactively to a deployment
that already built.

## 3. Register the OAuth redirect URIs

Both OAuth flows derive their `redirect_uri` from whatever origin the
request actually arrived on (`app/api/oauth/frameio/start/route.ts` and
`app/api/oauth/google/start/route.ts`), so there's no base-URL env var to
set for this — but Adobe and Google both need the exact callback URL
allowlisted ahead of time on their side, or they'll reject the OAuth
request.

Using your Vercel production domain from §1 (call it `<domain>`):

### 3.1 Frame.io (Adobe Developer Console)

1. In the [Adobe Developer Console](https://developer.adobe.com/console),
   create (or open) a project and add an OAuth Web App integration for
   Frame.io.
2. Add `https://<domain>/api/oauth/frameio/callback` to its allowed
   redirect URIs.
3. Copy the integration's Client ID / Client Secret into
   `FRAMEIO_CLIENT_ID` / `FRAMEIO_CLIENT_SECRET` (§2).

### 3.2 Google Calendar (Google Cloud Console)

1. In the [Google Cloud Console](https://console.cloud.google.com/),
   enable the Google Calendar API for your project, then create an OAuth
   2.0 Client ID of type "Web application" under APIs & Services →
   Credentials.
2. Add `https://<domain>/api/oauth/google/callback` as an authorized
   redirect URI.
3. Copy the Client ID / Client Secret into `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET` (§2).

## 4. Run migrations against Neon

This repo's schema lives in `lib/db/schema.ts`, with generated SQL
migrations checked in under `lib/db/migrations/`. Apply them to the real
Neon database once, from your own machine (or any shell with network
access to Neon), using the Neon connection string from §1.1:

```bash
DATABASE_URL="<your Neon connection string>" npx drizzle-kit migrate
```

This reads `dbCredentials.url` from `drizzle.config.ts` (which is wired to
`process.env.DATABASE_URL`) and applies every migration under
`lib/db/migrations/` in order. Re-running it later (e.g. after a schema
change ships a new migration) is safe — already-applied migrations are
skipped.

## 5. Connect Frame.io and Google Calendar (one-time, logged in)

Both of Work Hub's external integrations are connected by visiting a URL
once, while logged into the app's own passcode session (i.e. after
signing in at `/login` with the passcode from `WORK_HUB_PASSCODE_HASH`) —
these two routes sit behind the same `middleware.ts` session check as the
rest of the app:

1. Visit `https://<domain>/api/oauth/frameio/start` → approve Adobe's
   consent screen → you should land on a page showing
   `{"status":"connected","provider":"frameio"}`.
2. Visit `https://<domain>/api/oauth/google/start` → approve Google's
   consent screen → you should land on
   `{"status":"connected","provider":"google"}`.

Each stores an access/refresh token pair in the `oauth_tokens` table
(keyed by provider), which `lib/frameio/client.ts` and
`lib/calendar/google-client.ts` refresh automatically as they expire. If
either integration ever needs reconnecting (e.g. a refresh token gets
revoked), just revisit the same `/start` URL again — it overwrites the
stored row rather than erroring.

## 6. GitHub Actions: scheduled cron calls

`.github/workflows/cron.yml` calls the two protected cron endpoints on a
schedule — `poll-frameio` every 3 minutes, `fetch-calendar` every 15
minutes — each sending `Authorization: Bearer <CRON_SECRET>`. It needs
two repo secrets (GitHub repo → Settings → Secrets and variables →
Actions → New repository secret):

| Secret | Value |
| --- | --- |
| `CRON_SECRET` | The **exact same value** as the `CRON_SECRET` env var set in Vercel (§2). |
| `APP_BASE_URL` | The deployed origin from §1, no trailing slash — e.g. `https://work-hub.vercel.app`. |

Once both secrets are set, the workflow runs automatically on its
schedule. To check it immediately without waiting on the clock, go to the
repo's Actions tab → "Scheduled cron calls" → "Run workflow"
(`workflow_dispatch` — this runs both jobs at once, regardless of which
cron expression would normally trigger them).

A couple of GitHub Actions quirks worth knowing:

- Scheduled workflows only run on the repository's default branch.
- GitHub may delay a scheduled run by a few minutes under load — the
  3/15-minute cadence is a target, not a guarantee to the second.
- GitHub automatically disables scheduled workflows on a repo with no
  activity for 60 days. If the cron jobs silently stop appearing in the
  Actions log, check Settings → Actions and re-enable the workflow.

## 7. Verify end to end

1. Actions tab → confirm recent runs of both `poll-frameio` and
   `fetch-calendar` jobs are green. A red run's log will show the `curl`
   output — a `401` means `CRON_SECRET` doesn't match between Vercel and
   the GitHub Actions secret; any other error body comes straight from
   the route handler.
2. Open the deployed app, log in with the passcode, and confirm the
   dashboard shows live Frame.io review-queue items and real Google
   Calendar events (not empty/placeholder state) within one scheduled
   cycle of connecting both integrations in §5.
