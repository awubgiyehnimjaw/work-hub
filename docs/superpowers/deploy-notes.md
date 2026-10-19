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
| `WORK_HUB_PASSCODE_HASH` | A bcrypt hash of the single passcode Callum will type at `/login` — **not** the raw passcode. Generate it by running, from the project root, `node -e "console.log(require('bcryptjs').hashSync('YOUR-PASSCODE-HERE', 10))"` (uses the `bcryptjs` dependency already in `package.json`) and pasting the printed hash. **Use a real passphrase of at least 12 characters, not a short 4-6 digit PIN** — the login route now rate-limits guessing attempts (`lib/auth/rate-limit.ts`: 5 failed attempts triggers a 60-second lockout), but bcrypt's cost factor alone doesn't meaningfully protect a short numeric PIN against a determined/automated guesser, and this app holds real client business data behind it. |
| `CRON_SECRET` | Any long random string (e.g. `openssl rand -hex 32`). Gates `/api/cron/*` (`lib/auth/cron-secret.ts`). Must be set to the **exact same value** as the `CRON_SECRET` GitHub Actions secret in §6 — the GitHub Actions workflow sends this as a bearer token and Vercel checks it against this env var. |
| `VAPID_PUBLIC_KEY` | Generate a VAPID key pair with `npx web-push generate-vapid-keys` (uses the `web-push` dependency already in `package.json`). Use the printed public key here. |
| `VAPID_PRIVATE_KEY` | The private key from the same `web-push generate-vapid-keys` run. Server-side only — never expose this one under a `NEXT_PUBLIC_` name. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The **same value** as `VAPID_PUBLIC_KEY`, just also set under this `NEXT_PUBLIC_`-prefixed name so the browser-side `EnableNotificationsButton` component can read it for `pushManager.subscribe({ applicationServerKey })`. |
| `VAPID_SUBJECT` | A real `mailto:you@example.com` address or `https://` URL Callum controls — **not** a placeholder. This is the Web Push protocol's `sub` claim, which identifies the sender to push services; Apple's push service in particular is strict about it. `lib/push/send.ts` throws if this is unset, the same fail-closed pattern as the VAPID keys themselves, rather than silently sending a fake contact address. |
| `FRAMEIO_CLIENT_ID` | The Client ID of an Adobe Developer Console OAuth integration for Frame.io — see §3.1. |
| `FRAMEIO_CLIENT_SECRET` | The Client Secret from that same Adobe Developer Console integration. |
| `FRAMEIO_PROJECT_ID` | The Frame.io project Callum's editor delivers cuts into. Visible in the project's URL when viewing it at [app.frame.io](https://app.frame.io), or via the Frame.io V4 API's project list. |
| `FRAMEIO_ACCOUNT_ID` | The Frame.io account that project belongs to (used to build the V4 API path `/v4/accounts/{FRAMEIO_ACCOUNT_ID}/...` in `lib/frameio/client.ts`). Same source as `FRAMEIO_PROJECT_ID` — visible in the account's URL/settings in the Frame.io web app, or via the V4 API. |
| `GOOGLE_CLIENT_ID` | The Client ID of a Google Cloud Console OAuth 2.0 Client (type "Web application") — see §3.2. |
| `GOOGLE_CLIENT_SECRET` | The Client Secret from that same Google Cloud Console OAuth client. |
| `TELEGRAM_BOT_TOKEN` | The bot token from @BotFather — see §7.1. |
| `TELEGRAM_WEBHOOK_SECRET` | Any long random string (e.g. `openssl rand -hex 32`). Checked against the `X-Telegram-Bot-Api-Secret-Token` header on every webhook call (`lib/telegram/webhook-auth.ts`) — same bearer-secret shape as `CRON_SECRET`. Must be set to the **exact same value** passed as `secret_token` when registering the webhook in §7.3. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Comma-separated numeric Telegram chat ids — see §7.1. A message from any chat not in this list is fully ignored. |
| `GROQ_API_KEY` | A free API key from [console.groq.com](https://console.groq.com) (no card needed) — used for voice transcription and structured message parsing (`lib/groq/client.ts`). Originally built against OpenAI, switched after the bot's first live run hit `insufficient_quota` with no billing set up; Groq's API is OpenAI-compatible and its free tier is far more than this single-user bot will ever use. |
| `POSTING_SCHEDULE_SHEET_CSV_URL` | The posting-schedule Google Sheet's own CSV export URL — see §8. |

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

### 4.1 Seed the database

**Do this immediately after running migrations, before anything else
touches the app.** Migrations create empty tables — nothing inserts the
known client tags or the growth-suggestion seed list on its own. Skipping
this step has real consequences: `/api/suggestions` throws ("No active
suggestions available to pick from") the moment the review queue and
to-do list are both empty, and the first real Frame.io upload
auto-creates its client row with `recognized: false`, permanently
mis-flagging a real client as unrecognized.

```bash
DATABASE_URL="<your Neon connection string>" npm run db:seed
```

This runs `lib/db/seed-cli.ts`, which calls the same `seedClients()` and
`seedSuggestions()` used by the test suite. Both are idempotent (upsert
on each table's unique key), so re-running this later — e.g. after adding
a new client tag or suggestion to the seed lists in `lib/db/seed.ts` — is
safe and only inserts what's new.

As a second line of defense, `runFrameioPoll` (`lib/frameio/poll.ts`) also
calls both seed functions idempotently on every poll run, so a skipped
manual seed step self-heals on the very first scheduled poll rather than
leaving the app broken until someone remembers to run this command. Don't
rely on that instead of running this step, though — until the first poll
runs (or this command does), `/api/suggestions` is still broken.

### 4.2 Backfill client billing profiles and the October 2026 invoices

**This has a required run order — follow it exactly, in this sequence:**

1. Apply migrations `0009` and `0010` to production (`npx drizzle-kit
   migrate`, per §4 above) — safe to do *before* deploying the new
   Invoices code, since both are purely additive (new nullable columns on
   `clients`, new `invoices` table). Several existing code paths
   (`GET /api/clients/all`, `createInvoice`, the Frame.io poller, the seed
   script) select these new `clients` columns unconditionally — if the new
   code deploys before these migrations are applied, those break
   immediately with "column does not exist" errors.
2. Deploy the new code.
3. Run the backfill once against production (command below).
4. **Before generating any real invoice through the app**, verify both
   `ARC2610-001` and `ARC2610-002` now exist — e.g. open `/invoices` in
   the deployed app and confirm both appear in the list, or query the
   `invoices` table directly. Generating a real invoice before this step
   completes risks a real numbering collision: the app would compute
   `ARC2610-001` for whatever client is picked first, colliding with the
   real external "That Place" invoice already sent with that exact
   number, and `backfillOctoberInvoices` is written to throw a clear
   error (rather than silently proceeding) if it later finds that number
   claimed by something other than the expected backfill — so skipping
   this order turns into a hard failure, not a silent one, but it's
   simplest to just not get there.

**Do this once**, after migrations `0009`/`0010` have been applied to
production per step 1 above:

```bash
DATABASE_URL="<your Neon connection string>" npx tsx lib/db/backfill-invoices-cli.ts
```

This runs `lib/db/backfill-invoices-cli.ts`, which fills in the known
billing profiles (legal company name + address) for Lovelots, That Place,
and HappyFish, then records the two real invoices — `ARC2610-001` (That
Place) and `ARC2610-002` (Lovelots) — that were already issued to those
clients in October 2026, before this app's Invoices feature existed.
Skipping this means the app's own invoice-numbering sequence would start
from `ARC2610-001` again the first time an invoice is created against
either client, colliding with a number already in use.

Like `db:seed`, both steps this script runs
(`seedClientBillingProfiles`/`backfillOctoberInvoices`) are idempotent, so
re-running this command later is safe and a no-op.

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
schedule — `poll-frameio` every 5 minutes, `fetch-calendar` every 15
minutes — each sending `Authorization: Bearer <CRON_SECRET>`. It needs
two repo secrets (GitHub repo → Settings → Secrets and variables →
Actions → New repository secret):

**This repo must be public for GitHub Actions' free minutes to be
enough.** Each cron trigger fires its own billed workflow run (minimum 1
minute each, per GitHub's billing): poll-frameio every 5 minutes is
~8,640 runs/month, fetch-calendar every 15 minutes is another ~2,880 —
roughly 11,500 billed minutes/month combined. That's well past the 2,000
free minutes/month GitHub gives a PRIVATE repo, but unlimited (and free)
for a PUBLIC one. This is safe to
do: nothing secret is ever committed to the repo itself — `DATABASE_URL`,
`CRON_SECRET`, OAuth client secrets, VAPID keys, etc. are all environment
variables (Vercel) or GitHub Actions secrets, never source files. If
Callum would rather keep the repo private anyway, swap this workflow for
a free external scheduler like [cron-job.org](https://cron-job.org)
calling the same two `/api/cron/*` URLs with the same bearer header
instead of using GitHub Actions' schedule trigger.

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

## 7. Connect the Telegram bot

A voice or text message to this bot becomes a to-do or a client content
idea, with a one-line confirmation reply either way (see
`docs/superpowers/specs/2026-10-16-telegram-bot-content-ideas-design.md`
for the full design). Do this together, in order:

### 7.1 Create the bot and find the chat id

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send
   `/newbot`, and follow the prompts. BotFather replies with the bot
   token — this is `TELEGRAM_BOT_TOKEN`.
2. Find the numeric Telegram chat id for everyone who should be able to
   use the bot (Callum, plus anyone else) — these go into
   `TELEGRAM_ALLOWED_CHAT_IDS`, comma-separated; any chat not on this
   list is fully ignored. For each person, either have them message
   [@userinfobot](https://t.me/userinfobot) (it replies with their id
   directly), or have them send the new bot any message and then call
   `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` — the
   `message.chat.id` in the response is it.
3. Generate `TELEGRAM_WEBHOOK_SECRET` the same way as `CRON_SECRET`:
   `openssl rand -hex 32`.

### 7.2 Run the migration, set env vars, and deploy

This feature's tables (`content_ideas`, `telegram_updates`) come from
migration `0005` — run it against Neon the same way as §4, from your own
machine:

```bash
DATABASE_URL="<your Neon connection string>" npx drizzle-kit migrate
```

Skipping this step first means the webhook replies with nothing and
`/content-ideas` fails to load, since neither table exists yet.

Then set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_ALLOWED_CHAT_IDS`, and `GROQ_API_KEY` in Vercel (§2), and
redeploy.

### 7.3 Register the webhook

From your own machine, using the deployed domain from §1 (call it
`<domain>`):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<domain>/api/telegram/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

A `{"ok":true,...}` response means Telegram will now call that URL on
every message, sending `secret_token` back as the
`X-Telegram-Bot-Api-Secret-Token` header — exactly what
`lib/telegram/webhook-auth.ts` checks. Re-running this `curl` call later
(e.g. after rotating the secret) safely overwrites the registered
webhook rather than erroring.

### 7.4 Rename "Ulti" to "Ultimate Intern"

The content-ideas client roster assumes the existing "Ulti" client is
displayed as "Ultimate Intern". As part of this same setup pass, open
the already-shipped `/clients` page, edit that client, and change its
display name — no redeploy needed, this is a live data edit.

### 7.5 Try it

Send the bot a text message like "to do, test the new bot" and confirm
it replies and the to-do shows up on the dashboard; then try "content
idea for ARC, a test idea" and confirm it shows up on `/content-ideas`
under ARC. Try a voice note too.

## 8. Connect the posting-schedule sheet

Powers the dashboard's "Posting schedule — due soon" card and the daily
09:00 SGT push (anything due to post within 2 days) —
`lib/posting-schedule/sheet.ts`, `lib/reminders/check.ts`.

1. In the Google Sheet, File → Share → "Get link", and confirm it's set
   to "Anyone with the link" can view. No Google account/OAuth is needed
   on this app's side — the sheet's own CSV export is fetched directly.
2. Build the CSV export URL:
   `https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv&gid=<TAB_GID>`
   — `<SHEET_ID>` is the long id in the sheet's URL
   (`.../spreadsheets/d/<SHEET_ID>/edit...`), `<TAB_GID>` is the `gid=`
   value in the URL when that specific tab is open.
3. Set `POSTING_SCHEDULE_SHEET_CSV_URL` to that URL in Vercel (§2), and
   redeploy.
4. The sheet needs exactly this header row, in this order: `Client,
   Video, Edit By, Post Date, Notes, Posted` — only `Client`, `Video`,
   `Post Date`, and `Notes` are read (`Edit By`/`Posted` are the
   editor's own tracking columns, unused here). `Post Date` must be in
   the sheet's default "DD Mon YYYY" format (e.g. "16 Oct 2026"). A row
   with `Notes` set to `DONE` or `HOLD` (case-insensitive) is treated as
   not needing a reminder, even if its Post Date is otherwise due soon.

## 9. Verify end to end

1. Actions tab → confirm recent runs of both `poll-frameio` and
   `fetch-calendar` jobs are green. A red run's log will show the `curl`
   output — a `401` means `CRON_SECRET` doesn't match between Vercel and
   the GitHub Actions secret; any other error body comes straight from
   the route handler.
2. Open the deployed app, log in with the passcode, and confirm the
   dashboard shows live Frame.io review-queue items and real Google
   Calendar events (not empty/placeholder state) within one scheduled
   cycle of connecting both integrations in §5.
