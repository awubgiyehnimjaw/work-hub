# Work Hub MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-user Progressive Web App, usable on iPhone and MacBook, that surfaces Frame.io review tasks (push-notified), a Google Calendar agenda, a to-do list, and idle-time growth suggestions.

**Architecture:** Next.js (App Router, TypeScript) deployed on Vercel, serving both the PWA frontend and its own API routes. Postgres (Neon) via Drizzle ORM holds all state. Two external cron callers (GitHub Actions scheduled workflow) hit protected API endpoints to poll Frame.io and refresh the Google Calendar cache, since this avoids Vercel's cron tier limits. Web Push (VAPID) delivers notifications. A single passcode protects the whole app behind a signed session cookie; cron endpoints are protected separately by a bearer secret.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Drizzle ORM + Neon Postgres, Vitest for tests, `web-push` npm package, Frame.io V4 API (OAuth via Adobe Developer Console), Google Calendar API v3 (OAuth), GitHub Actions for scheduling.

**Spec:** `docs/superpowers/specs/2026-10-13-work-hub-design.md`

## Global Constraints

- Push notifications are mandatory, not optional — every review task creation must attempt a push send.
- Frame.io is polled (not webhooked) every 2-5 minutes; this plan pins the GitHub Actions schedule to every 3 minutes.
- Google Calendar is fetched roughly every 15 minutes, not via push "watch" channels.
- A review task unactioned (not completed, not currently snoozed) for 2+ days gets an `isStale` flag.
- A client with no activity (`lastActivityAt`) for 3+ weeks surfaces as a dynamic "client-quiet" suggestion.
- Client tags are parsed from a trailing bracketed group in the filename, e.g. `Final Cut (Lovelots).mp4`.
- Known client tags at launch: Lovelots, Lesamai, That Place, HappyFish, NLD, ARC, Ulti. An unrecognized tag must still produce a task, flagged unrecognized — never silently dropped.
- Review tasks are marked done manually in-app; there is no auto-detection of Frame.io comments.
- Growth suggestions come from a fixed, DB-seeded list (the exact seed text is in the spec's "Idle-time suggestions" section) plus the dynamic client-quiet nudge — never generated fresh at runtime.
- Quick-add for to-dos is an in-app button opening a focused text field — not an OS share-sheet target (unsupported on iOS Safari).
- Single passcode auth only; no multi-user accounts.
- Hosting stays on free tiers: Vercel, Neon, GitHub Actions — no paid cron tier required.

## Review Focus

- An upload whose filename has no bracketed tag, or a tag that matches no known client — must still create a task (flagged unrecognized), never get silently dropped. (Task 6)
- The same Frame.io file appearing in two consecutive poll windows (pagination overlap, clock skew) — must not create a second task for it. (Task 6)
- A cron endpoint (`/api/cron/*`) called without a valid bearer secret — must return 401 and must not touch the database or call the external API. (Task 6, Task 10)
- A push send to a subscription the browser has since unregistered (push service returns 404/410) — must not crash the poll run; the stale subscription row must be removed. (Task 8)
- A snoozed task whose `snoozedUntil` is exactly at or before "now" — must appear in the active queue again, not stay hidden. (Task 11)

---

## File Structure

```
app/
  layout.tsx                      # root layout, manifest link, SW registration
  login/page.tsx                  # passcode entry
  page.tsx                        # dashboard (Today view)
  history/page.tsx                # per-client history log
  api/
    auth/login/route.ts
    auth/logout/route.ts
    tasks/route.ts                # GET active tasks, POST quick-add to-do
    tasks/[id]/route.ts           # PATCH complete/snooze
    suggestions/route.ts          # GET current suggestion
    calendar/route.ts             # GET cached events
    push/subscribe/route.ts       # POST save push subscription
    oauth/frameio/start/route.ts
    oauth/frameio/callback/route.ts
    oauth/google/start/route.ts
    oauth/google/callback/route.ts
    cron/poll-frameio/route.ts
    cron/fetch-calendar/route.ts
lib/
  db/schema.ts                    # Drizzle tables
  db/client.ts                    # Neon/Drizzle connection
  db/seed.ts                      # seeds clients + suggestions
  auth/session.ts                 # session cookie create/verify
  auth/cron-secret.ts             # bearer secret check
  frameio/client.ts                # listNewFiles()
  frameio/parse-client-tag.ts      # pure filename parser
  frameio/poll.ts                  # core poll logic
  calendar/google-client.ts        # listUpcomingEvents()
  calendar/fetch.ts                # core fetch-and-cache logic
  push/send.ts                     # sendPush()
  tasks/aging.ts                   # isTaskStale()
  suggestions/pick.ts              # pickSuggestion()
public/
  manifest.json
  sw.js
.github/workflows/cron.yml         # scheduled calls to the two cron endpoints
```

---

## Task 1: Project Scaffold & Health Check

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `app/layout.tsx`, `app/page.tsx` (placeholder)
- Create: `app/api/health/route.ts`
- Test: `tests/api/health.test.ts`
- Create: `.env.example` (lists every env var used anywhere in this plan: `DATABASE_URL`, `SESSION_SECRET`, `WORK_HUB_PASSCODE_HASH`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `FRAMEIO_CLIENT_ID`, `FRAMEIO_CLIENT_SECRET`, `FRAMEIO_PROJECT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)

**Interfaces:**
- Produces: `GET /api/health` returns `{ status: "ok" }`, 200.

- [ ] **Step 1: Scaffold a Next.js 15 App Router + TypeScript project** with Vitest configured for `tests/**/*.test.ts`.

- [ ] **Step 2: Write the failing test** for the health route.

```ts
// tests/api/health.test.ts
import { GET } from "@/app/api/health/route";

test("health check returns ok", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok" });
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx vitest run tests/api/health.test.ts` — expect FAIL (route not defined).

- [ ] **Step 4: Implement `GET()` in `app/api/health/route.ts`** returning `NextResponse.json({ status: "ok" })`.

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run tests/api/health.test.ts` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with health check"
```

---

## Task 2: Database Schema, Migrations, Seed Data

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/client.ts`
- Create: `lib/db/seed.ts`
- Test: `tests/db/seed.test.ts`

**Interfaces:**
- Produces tables (Drizzle):
  - `clients`: `id (uuid pk)`, `tag (text, unique)`, `displayName (text)`, `recognized (boolean)`, `lastActivityAt (timestamp, nullable)`
  - `tasks`: `id (uuid pk)`, `type ('review'|'todo')`, `title (text)`, `clientId (uuid, nullable fk -> clients.id)`, `frameioFileId (text, nullable, unique)`, `frameioUrl (text, nullable)`, `status ('active'|'completed')`, `createdAt (timestamp)`, `completedAt (timestamp, nullable)`, `snoozedUntil (timestamp, nullable)`
  - `suggestions`: `id (uuid pk)`, `category ('ulti'|'arc'|'general')`, `text (text)`, `active (boolean)`
  - `pushSubscriptions`: `id (uuid pk)`, `endpoint (text, unique)`, `p256dh (text)`, `auth (text)`, `createdAt (timestamp)`
  - `calendarEventsCache`: `id (uuid pk)`, `googleEventId (text, unique)`, `title (text)`, `startAt (timestamp)`, `endAt (timestamp)`, `location (text, nullable)`
  - `oauthTokens`: `id (uuid pk)`, `provider ('frameio'|'google')`, `accessToken (text)`, `refreshToken (text)`, `expiresAt (timestamp)`
- Produces: `seedClients(): Promise<void>` and `seedSuggestions(): Promise<void>` in `lib/db/seed.ts`, both idempotent (upsert on unique key).
- Consumes: none (foundational).

- [ ] **Step 1: Define the Drizzle schema** in `lib/db/schema.ts` per the table list above.

- [ ] **Step 2: Set up migrations** (`drizzle-kit`) and run the initial migration against a Neon dev database.

- [ ] **Step 3: Write the failing test** for seeding.

```ts
// tests/db/seed.test.ts
test("seedClients creates the known client tags exactly once each", async () => {
  await seedClients();
  await seedClients(); // idempotent
  const rows = await db.select().from(clients);
  const tags = rows.map(r => r.tag).sort();
  expect(tags).toEqual(["ARC", "HappyFish", "Lesamai", "Lovelots", "NLD", "That Place", "Ulti"].sort());
  expect(rows.every(r => r.recognized === true)).toBe(true);
});
```

- [ ] **Step 4: Run test to verify it fails** — expect FAIL (`seedClients` not defined).

- [ ] **Step 5: Implement `seedClients()` and `seedSuggestions()`** in `lib/db/seed.ts`. `seedSuggestions()` inserts the exact seed list from the spec's "Idle-time suggestions" section (Ulti/ARC/general categories), upserting on `text`.

- [ ] **Step 6: Run test to verify it passes.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add database schema, migrations, and seed data"
```

---

## Task 3: Passcode Auth

**Files:**
- Create: `lib/auth/session.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `middleware.ts`
- Create: `app/login/page.tsx`
- Test: `tests/auth/session.test.ts`
- Test: `tests/api/auth-login.test.ts`

**Interfaces:**
- Produces: `createSessionCookie(): string`, `verifySessionCookie(value: string | undefined): boolean` in `lib/auth/session.ts`, both using HMAC-SHA256 signing with `SESSION_SECRET`.
- Produces: `POST /api/auth/login` — body `{ passcode: string }` — checks against `bcrypt.compare(passcode, process.env.WORK_HUB_PASSCODE_HASH)`; on success sets an HTTP-only `session` cookie via `createSessionCookie()`, 200; on failure, 401.
- Produces: `POST /api/auth/logout` — clears the cookie, 200.
- Produces: `middleware.ts` — redirects to `/login` for any route outside `/login`, `/api/auth/*`, `/api/cron/*` when `verifySessionCookie(cookies().get("session")?.value)` is false.

- [ ] **Step 1: Write the failing test** for session signing.

```ts
// tests/auth/session.test.ts
test("verifySessionCookie accepts a cookie created by createSessionCookie", () => {
  const cookie = createSessionCookie();
  expect(verifySessionCookie(cookie)).toBe(true);
});

test("verifySessionCookie rejects a tampered cookie", () => {
  expect(verifySessionCookie("garbage")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement `createSessionCookie`/`verifySessionCookie`** in `lib/auth/session.ts`.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Write the failing test** for the login route (correct and incorrect passcode).

- [ ] **Step 6: Run test to verify it fails.**

- [ ] **Step 7: Implement the login/logout routes and `middleware.ts`**, plus a minimal `app/login/page.tsx` form posting to `/api/auth/login`.

- [ ] **Step 8: Run tests to verify they pass.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add passcode session auth"
```

---

## Task 4: Frame.io Client-Tag Parser

**Files:**
- Create: `lib/frameio/parse-client-tag.ts`
- Test: `tests/frameio/parse-client-tag.test.ts`

**Interfaces:**
- Produces: `parseClientTag(filename: string): string | null` — returns the text inside the last `(...)` group in the filename (trimmed), or `null` if there is no bracketed group at all.
- Consumes: none.

- [ ] **Step 1: Write the failing tests.**

```ts
test("extracts tag from a normal filename", () => {
  expect(parseClientTag("Final Cut (Lovelots).mp4")).toBe("Lovelots");
});
test("extracts the last bracket group when there are multiple", () => {
  expect(parseClientTag("Draft (v2) Final (NLD).mov")).toBe("NLD");
});
test("returns null when there is no bracket group", () => {
  expect(parseClientTag("final_cut.mp4")).toBeNull();
});
test("trims whitespace inside the brackets", () => {
  expect(parseClientTag("Cut ( That Place ).mp4")).toBe("That Place");
});
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `parseClientTag`** using a regex matching the last `(...)` group.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Frame.io filename client-tag parser"
```

---

## Task 5: Frame.io OAuth Connect

**Files:**
- Create: `app/api/oauth/frameio/start/route.ts`
- Create: `app/api/oauth/frameio/callback/route.ts`
- Create: `lib/frameio/oauth.ts`
- Test: `tests/frameio/oauth.test.ts`

**Interfaces:**
- Produces: `GET /api/oauth/frameio/start` — redirects to Adobe IMS OAuth authorize URL built from `FRAMEIO_CLIENT_ID` with the Frame.io API scopes.
- Produces: `GET /api/oauth/frameio/callback?code=...` — exchanges `code` for an access/refresh token pair via `exchangeFrameioCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }>` (in `lib/frameio/oauth.ts`), then upserts a row in `oauthTokens` with `provider = 'frameio'`.
- Consumes: `oauthTokens` table (Task 2).

- [ ] **Step 1: Write the failing test for `exchangeFrameioCode`**, mocking the Adobe token endpoint with `vi.mock("node:fetch"-equivalent)` or an injected fetch function, asserting it returns the parsed token fields from a mocked JSON response.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement `exchangeFrameioCode`** in `lib/frameio/oauth.ts`, and the two route handlers (this route is visited manually once by Callum during setup, behind the existing passcode session).

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Frame.io OAuth connect flow"
```

---

## Task 6: Frame.io Poll Endpoint

**Files:**
- Create: `lib/frameio/client.ts`
- Create: `lib/frameio/poll.ts`
- Create: `lib/auth/cron-secret.ts`
- Create: `app/api/cron/poll-frameio/route.ts`
- Test: `tests/frameio/poll.test.ts`
- Test: `tests/api/cron-poll-frameio.test.ts`

**Interfaces:**
- Produces: `listNewFiles(sinceISO: string): Promise<FrameioFile[]>` in `lib/frameio/client.ts`, where `FrameioFile = { id: string; name: string; createdAt: string }`, authenticated using the stored `oauthTokens` row for `frameio`.
- Produces: `checkCronSecret(req: Request): boolean` in `lib/auth/cron-secret.ts` — compares the `Authorization: Bearer <token>` header against `process.env.CRON_SECRET`.
- Produces: `buildFrameioUrl(fileId: string): string` in `lib/frameio/client.ts`, returning `` `https://app.frame.io/player/${fileId}` ``. Note for the implementer: confirm this against a real response from `listNewFiles` against Callum's account before shipping — if the Frame.io API returns its own view/share URL field on the file object, prefer that field over this constructed one.
- Produces: `runFrameioPoll(): Promise<{ created: number; unrecognized: number }>` in `lib/frameio/poll.ts`. For each new file since the last recorded poll time: parse the tag with `parseClientTag`; look up or create (if unrecognized) the matching `clients` row (`recognized = tag is in the known list`); skip if a `tasks` row with that `frameioFileId` already exists (dedup); otherwise insert a `tasks` row (`type: 'review'`, title `Review — ${client.displayName}`, `frameioFileId: file.id`, `frameioUrl: buildFrameioUrl(file.id)`), update `clients.lastActivityAt`, and call `sendPush` (Task 8) for every stored subscription with `payload.url = task.frameioUrl`.
- Produces: `GET /api/cron/poll-frameio` — returns 401 immediately (no DB or Frame.io calls) if `checkCronSecret` fails; otherwise calls `runFrameioPoll()` and returns its result as JSON, 200.
- Consumes: `parseClientTag` (Task 4), `clients`/`tasks` tables (Task 2), `sendPush` (Task 8 — see note below).

> Note: `sendPush` is defined in Task 8. If executing tasks in order, stub `sendPush` as a no-op here with the exact signature from Task 8's Interfaces block and wire the real implementation when Task 8 lands; the test for this task mocks the import regardless.

- [ ] **Step 1: Write the failing tests for `runFrameioPoll`**, mocking `listNewFiles` to return fixture files:

```ts
test("creates a task for a recognized client tag", async () => { /* file "Cut (Lovelots).mp4" -> one task, client.lastActivityAt updated */ });
test("creates a flagged task for an unrecognized tag, never drops it", async () => { /* file "Cut (RandomCo).mp4" -> task created, client.recognized === false */ });
test("creates a flagged task when there is no bracket tag at all", async () => { /* file "final.mp4" -> task still created */ });
test("does not create a duplicate task for a file already recorded", async () => { /* same frameioFileId polled twice -> one task row */ });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `listNewFiles`, `checkCronSecret`, and `runFrameioPoll`** per the Interfaces block.

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Write the failing test for the route's auth gate.**

```ts
test("GET /api/cron/poll-frameio returns 401 and calls nothing without a valid secret", async () => { /* mock runFrameioPoll, assert not called, assert 401 */ });
```

- [ ] **Step 6: Run test to verify it fails.**

- [ ] **Step 7: Implement the route handler.**

- [ ] **Step 8: Run tests to verify they pass.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add Frame.io polling and review-task creation"
```

---

## Task 7: Push Subscription Storage

**Files:**
- Create: `app/api/push/subscribe/route.ts`
- Test: `tests/api/push-subscribe.test.ts`

**Interfaces:**
- Produces: `POST /api/push/subscribe` — body is a browser `PushSubscriptionJSON` (`{ endpoint, keys: { p256dh, auth } }`) — upserts a row in `pushSubscriptions` keyed on `endpoint`, 200.
- Consumes: `pushSubscriptions` table (Task 2).

- [ ] **Step 1: Write the failing test** posting a subscription payload and asserting a row exists afterward, then posting the same payload again and asserting still exactly one row.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement the route handler.**

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add push subscription storage endpoint"
```

---

## Task 8: Push Send Wrapper

**Files:**
- Create: `lib/push/send.ts`
- Test: `tests/push/send.test.ts`
- Modify: `lib/frameio/poll.ts` (replace the stubbed `sendPush` import with the real one)

**Interfaces:**
- Produces: `sendPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url: string }): Promise<void>` in `lib/push/send.ts`, wrapping the `web-push` package configured with `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`. On a 404/410 response from the push service, deletes the matching `pushSubscriptions` row instead of throwing; on any other error, logs and continues (does not throw, so one bad subscription cannot abort a poll run processing several tasks).
- Consumes: `pushSubscriptions` table (Task 2).

- [ ] **Step 1: Write the failing tests**, mocking the `web-push` module:

```ts
test("sendPush delivers to a valid subscription", async () => { /* mock webpush.sendNotification resolves, assert called with expected payload */ });
test("sendPush removes the subscription row on a 410 Gone response", async () => { /* mock rejects with {statusCode: 410}, assert row deleted, assert no throw */ });
test("sendPush does not throw on an unrelated error", async () => { /* mock rejects with {statusCode: 500}, assert resolves anyway */ });
```

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `sendPush`.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Wire the real `sendPush` into `runFrameioPoll`** (Task 6), replacing the stub import.

- [ ] **Step 6: Run the Task 6 poll tests again to confirm nothing broke** — `npx vitest run tests/frameio/poll.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add web push sending and wire into Frame.io poll"
```

---

## Task 9: Google OAuth Connect

**Files:**
- Create: `app/api/oauth/google/start/route.ts`
- Create: `app/api/oauth/google/callback/route.ts`
- Create: `lib/calendar/oauth.ts`
- Test: `tests/calendar/oauth.test.ts`

**Interfaces:**
- Produces: `GET /api/oauth/google/start` — redirects to Google's OAuth consent screen requesting the Calendar read-only scope, built from `GOOGLE_CLIENT_ID`.
- Produces: `GET /api/oauth/google/callback?code=...` — exchanges `code` via `exchangeGoogleCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }>` (in `lib/calendar/oauth.ts`), upserts into `oauthTokens` with `provider = 'google'`.
- Consumes: `oauthTokens` table (Task 2).

- [ ] **Step 1: Write the failing test for `exchangeGoogleCode`**, mocking Google's token endpoint.

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Implement `exchangeGoogleCode`** and the two route handlers.

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Google Calendar OAuth connect flow"
```

---

## Task 10: Calendar Fetch Endpoint

**Files:**
- Create: `lib/calendar/google-client.ts`
- Create: `lib/calendar/fetch.ts`
- Create: `app/api/cron/fetch-calendar/route.ts`
- Test: `tests/calendar/fetch.test.ts`
- Test: `tests/api/cron-fetch-calendar.test.ts`

**Interfaces:**
- Produces: `listUpcomingEvents(withinDays: number): Promise<GoogleCalendarEvent[]>` in `lib/calendar/google-client.ts`, where `GoogleCalendarEvent = { id: string; title: string; startAt: string; endAt: string; location?: string }`, authenticated via the stored Google `oauthTokens` row.
- Produces: `refreshCalendarCache(): Promise<{ cached: number }>` in `lib/calendar/fetch.ts` — calls `listUpcomingEvents(14)`, upserts each into `calendarEventsCache` keyed on `googleEventId`, and deletes cached rows whose `googleEventId` is no longer in the fetched set (so cancelled events disappear).
- Produces: `GET /api/cron/fetch-calendar` — same `checkCronSecret` gate as Task 6 (401, no side effects, if invalid); otherwise calls `refreshCalendarCache()`.
- Consumes: `checkCronSecret` (Task 6), `calendarEventsCache` table (Task 2).

- [ ] **Step 1: Write the failing tests for `refreshCalendarCache`**, mocking `listUpcomingEvents`: caches new events, updates a changed event's time, removes an event no longer returned.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `listUpcomingEvents` and `refreshCalendarCache`.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Write the failing test for the route's auth gate** (mirrors Task 6 Step 5).

- [ ] **Step 6: Run test to verify it fails.**

- [ ] **Step 7: Implement the route handler.**

- [ ] **Step 8: Run tests to verify they pass.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add Google Calendar fetch and caching"
```

---

## Task 11: Tasks API (list, quick-add, complete, snooze, aging)

**Files:**
- Create: `lib/tasks/aging.ts`
- Create: `app/api/tasks/route.ts`
- Create: `app/api/tasks/[id]/route.ts`
- Test: `tests/tasks/aging.test.ts`
- Test: `tests/api/tasks.test.ts`

**Interfaces:**
- Produces: `isTaskStale(task: { status: string; snoozedUntil: Date | null; createdAt: Date }, now: Date): boolean` in `lib/tasks/aging.ts` — `true` only if `status === 'active'`, and (`snoozedUntil` is null or `snoozedUntil <= now`), and `now - createdAt >= 2 days`.
- Produces: `GET /api/tasks` — returns all tasks where `status = 'active'` and (`snoozedUntil` is null or `<= now`), each annotated with `isStale: isTaskStale(...)`, sorted oldest-first.
- Produces: `POST /api/tasks` — body `{ title: string }` — creates a `type: 'todo'` task, 201.
- Produces: `PATCH /api/tasks/:id` — body `{ action: 'complete' } | { action: 'snooze'; until: string (ISO) }` — `complete` sets `status: 'completed'`, `completedAt: now`; `snooze` sets `snoozedUntil` to the given ISO timestamp. 200, or 404 if the task doesn't exist.
- Consumes: `tasks` table (Task 2).

- [ ] **Step 1: Write the failing tests for `isTaskStale`** covering: fresh task (false), 3-day-old active task (true), completed task regardless of age (false), snoozed task whose `snoozedUntil` is in the future (false), snoozed task whose `snoozedUntil` is exactly `now` (true — reappears).

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `isTaskStale`.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Write the failing tests for the three routes** (list excludes completed and still-snoozed tasks; quick-add creates a `todo`; complete and snooze update the right fields; snooze with a past timestamp makes the task reappear in the next list call).

- [ ] **Step 6: Run tests to verify they fail.**

- [ ] **Step 7: Implement the three route handlers.**

- [ ] **Step 8: Run tests to verify they pass.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add tasks API with quick-add, complete, snooze, and aging"
```

---

## Task 12: Suggestions Logic & API

**Files:**
- Create: `lib/suggestions/pick.ts`
- Create: `app/api/suggestions/route.ts`
- Test: `tests/suggestions/pick.test.ts`

**Interfaces:**
- Produces: `pickSuggestion(now: Date): Promise<{ text: string; source: 'seed' | 'client-quiet'; clientId?: string }>` in `lib/suggestions/pick.ts`. If any `clients` row has `lastActivityAt` older than 3 weeks before `now` (or `null` with the client `recognized = true`), returns a `client-quiet` suggestion naming that client (oldest `lastActivityAt` first). Otherwise, returns the next active row from `suggestions` in round-robin order (tracked by a `lastPickedAt` style approach: pick the least-recently-returned active suggestion).
- Produces: `GET /api/suggestions` — returns `pickSuggestion(new Date())` as JSON, but only reachable from the dashboard when `GET /api/tasks` would return an empty list (the client decides this; the route itself always answers).
- Consumes: `clients`/`suggestions` tables (Task 2).

- [ ] **Step 1: Write the failing tests for `pickSuggestion`**: returns a client-quiet suggestion when one client is 4 weeks quiet; returns a seed suggestion when all clients are recently active; round-robins seed suggestions rather than repeating the same one every call.

- [ ] **Step 2: Run tests to verify they fail.**

- [ ] **Step 3: Implement `pickSuggestion`.**

- [ ] **Step 4: Run tests to verify they pass.**

- [ ] **Step 5: Implement the `GET /api/suggestions` route.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add idle-time suggestion logic"
```

---

## Task 13: Dashboard UI (Today View)

**Files:**
- Modify: `app/page.tsx`
- Create: `app/components/ReviewQueue.tsx`
- Create: `app/components/TodoList.tsx`
- Create: `app/components/CalendarAgenda.tsx`
- Create: `app/components/SuggestionCard.tsx`
- Create: `app/components/QuickAddButton.tsx`

**Interfaces:**
- Consumes: `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/:id`, `GET /api/calendar`, `GET /api/suggestions` (all prior tasks).
- Produces: the dashboard page rendering, in order: review-queue tasks (with a visual stale indicator when `isStale`, and snooze/complete actions), the to-do list (with `QuickAddButton` opening a focused text input), the calendar agenda for the next 14 days, and `SuggestionCard` shown only when both the review queue and to-do list are empty.

- [ ] **Step 1: Build `ReviewQueue`** rendering tasks of `type: 'review'`, each as a tappable "Open in Frame.io" link to `task.frameioUrl` plus Complete and Snooze (2h / tomorrow morning) actions calling `PATCH /api/tasks/:id`, with a distinct style when `isStale`.

- [ ] **Step 2: Build `TodoList` and `QuickAddButton`**, `QuickAddButton` opening a text input auto-focused on tap, posting to `POST /api/tasks` on submit.

- [ ] **Step 3: Build `CalendarAgenda`** fetching `GET /api/calendar` (create this GET route here, reading from `calendarEventsCache`) and listing events chronologically.

- [ ] **Step 4: Build `SuggestionCard`** fetching `GET /api/suggestions`, shown only when the queue and to-do list are both empty.

- [ ] **Step 5: Wire all four into `app/page.tsx`.**

- [ ] **Step 6: Manual verification**: run the dev server, log in with the passcode, confirm the dashboard renders with seeded data and the quick-add flow works end-to-end.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add dashboard UI (review queue, to-dos, calendar, suggestions)"
```

---

## Task 14: History Page UI

**Files:**
- Create: `app/history/page.tsx`
- Modify: `app/api/tasks/route.ts` (add an optional `?status=completed&clientId=` query to support this page, reusing the existing handler)

**Interfaces:**
- Consumes: `GET /api/tasks?status=completed` (extended in this task).
- Produces: a page listing completed review tasks grouped by client, each with its `completedAt` date, so Callum can see volume per client over time.

- [ ] **Step 1: Extend `GET /api/tasks`** to accept `status` and `clientId` query params, defaulting to the Task 11 behavior when absent.

- [ ] **Step 2: Build `app/history/page.tsx`** grouping and rendering completed tasks by client.

- [ ] **Step 3: Manual verification**: complete a couple of seeded/test tasks via the dashboard, confirm they appear grouped correctly on the history page.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add per-client history page"
```

---

## Task 15: PWA Install & Push Permission

**Files:**
- Create: `public/manifest.json`
- Create: `public/sw.js`
- Modify: `app/layout.tsx` (manifest link, service worker registration script)
- Create: `app/components/EnableNotificationsButton.tsx`

**Interfaces:**
- Consumes: `POST /api/push/subscribe` (Task 7).
- Produces: an installable PWA (manifest + icons + service worker handling `push` and `notificationclick` events, the latter opening the dashboard URL from the notification payload), and a button that requests Notification permission and, on grant, subscribes via the browser Push API and posts the subscription to `/api/push/subscribe`.

- [ ] **Step 1: Write `public/manifest.json`** (name, icons, `display: "standalone"`, theme/background colors).

- [ ] **Step 2: Write `public/sw.js`** handling `push` (show a notification from the payload) and `notificationclick` (focus/open the dashboard).

- [ ] **Step 3: Register the service worker** in `app/layout.tsx`.

- [ ] **Step 4: Build `EnableNotificationsButton`** requesting permission, subscribing, and posting to `/api/push/subscribe`.

- [ ] **Step 5: Manual verification**: install the app to an iPhone Home Screen and a Mac via Safari, grant notification permission, trigger `/api/cron/poll-frameio` manually against a test file, confirm a push notification arrives on both devices.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add PWA manifest, service worker, and push permission flow"
```

---

## Task 16: Scheduler Wiring & Deployment

**Files:**
- Create: `.github/workflows/cron.yml`
- Create: `docs/superpowers/deploy-notes.md` (env vars to set in Vercel, Neon connection setup, one-time OAuth connect steps, GitHub Actions secret setup)

**Interfaces:**
- Consumes: `GET /api/cron/poll-frameio` (Task 6), `GET /api/cron/fetch-calendar` (Task 10).
- Produces: a GitHub Actions workflow with two scheduled jobs — one every 3 minutes calling `poll-frameio`, one every 15 minutes calling `fetch-calendar` — both sending `Authorization: Bearer ${{ secrets.CRON_SECRET }}` and matching the deployed `CRON_SECRET` env var.

- [ ] **Step 1: Write `.github/workflows/cron.yml`** with the two scheduled jobs per the Interfaces block (`schedule: cron: "*/3 * * * *"` and `"*/15 * * * *"`), each a `curl` call with the bearer header.

- [ ] **Step 2: Write `docs/superpowers/deploy-notes.md`** listing every env var from `.env.example` (Task 1) with where it comes from, plus the one-time steps: deploy to Vercel, set env vars, run migrations against Neon, visit `/api/oauth/frameio/start` and `/api/oauth/google/start` once each (logged in), add `CRON_SECRET` as a GitHub Actions repo secret.

- [ ] **Step 3: Manual verification**: deploy, follow the deploy notes end-to-end, confirm both cron jobs run successfully in the Actions log and the dashboard shows live data.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add scheduler workflow and deployment notes"
```
