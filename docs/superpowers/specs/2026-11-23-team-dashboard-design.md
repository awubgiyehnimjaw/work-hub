# Team Dashboard — Design

## Intent and why

The existing ARC Hub home page is built for Callum's own quick daily glance — small cards, only what's due soon. He wants a second, separate surface inside the same app: a shared view he and his employees can use to search, filter, and see status breakdowns across the operational data the app already tracks, styled sleek and black-and-white.

## Goals

- A new section inside the existing app (not a new deployment), reachable with the same shared passcode login already in place.
- Covers four domains — to-dos, Frame.io review tasks, posting schedule, content ideas — "basically what the app shows," organized as tabs, one tab per domain.
- Full and current, not just "due soon": the existing posting-schedule card only shows what's due within 3 days; this shows everything, with status breakdowns as stat cards.
- Visual language from the approved mockup: black-and-white, tabs across the top, a stat-card row, a search bar plus status/client filter pills, a table below. Status read by shape/weight (filled/outline/grey dot), never color.

## Non-goals

- Not a separate deployment, codebase, or login system.
- Not editable — no marking things done, no adding/deleting/editing rows from this surface.
- No per-employee or per-client scoping — every logged-in employee sees every client's data, same as the main app today.

## Anti-goals

Would make this a failure even if it "technically works":

- A second passcode system, or any divergence from the app's existing auth.
- Showing stale data instead of what's actually in the database/sheet right now.
- Becoming editable by accident — two places that can change the same data differently.

## Constraints

- Lives inside the existing Next.js app (`work-hub`), same deployment. `middleware.ts` protects everything by default except an explicit allowlist (`/login`, `/api/auth`, `/api/cron`, `/api/telegram`, PWA assets) — a new route needs no new auth code.
- Reuses existing data wherever it exists: `GET /api/tasks` (to-dos + reviews), `GET /api/content-ideas/all`.
- Needs one new, small endpoint for the *full* posting-schedule list (not just due-soon), built on the existing `lib/posting-schedule/sheet.ts` CSV parsing — no new data storage, no new external integration.
- Invoices and growth Suggestions are excluded entirely.

## Approaches considered

- **Chosen: a new route inside the existing app** (e.g. `/team`), with its own layout/nav, reusing the app's existing passcode middleware and existing API routes.
- **Rejected: a separate deployment/repo.** Would mean rebuilding login and the database connection from scratch for the exact same data and the same password — pure duplicated work for no benefit, since Callum confirmed he wants the same shared login, not a different one.
- **Rejected: a static/Artifact-style page.** Can't hold a real login (fails the "same shared way in" requirement), and the data would go stale instead of reflecting the live app.

## Decided (from the conversation with Callum)

- Audience: Callum and his employees, one shared login — the existing passcode, not individual accounts.
- Visibility: no per-person or per-client scoping. Everyone who's logged in sees everything.
- Scope: Tasks, Reviews, Posting Schedule, Content Ideas. Invoices and Suggestions are out.
- Visual direction: approved against a live mockup — tabs (Tasks / Reviews / Posting Schedule / Content Ideas), a stat-card row, search + filter pills (status, and client where relevant), a table. Black-and-white; status shown via dot fill (filled = urgent/overdue, outline = upcoming, grey = settled), not color.

## Left to the builder (my calls — flag if any of these are wrong)

- **Read-only.** No mutation actions (mark done, add, delete, edit) on this new surface — the existing app's own components (`TodoList`, `ReviewQueue`, `PostingSchedule`) already own those actions; this is an overview/reporting surface, not a second place to manage the same data. The approved mockup had no edit affordances and that wasn't flagged, which I'm taking as confirmation.
- **Route:** `/team` — short, clearly distinct from the existing `/` home dashboard. Easy to rename.
- **New endpoint:** `GET /api/posting-schedule/all` — the full, unfiltered list, reusing `fetchPostingScheduleCsv`/`parsePostingScheduleCsv` from `lib/posting-schedule/sheet.ts` without the due-soon filter, annotated with the same `entryKey`/status-style tagging the existing due-soon endpoint already does (extended to cover non-due-soon buckets — see stat cards below).
- **Stat cards per tab:**
  - *Posting Schedule:* Total, Due soon (≤3 days), Overdue, Done, On hold.
  - *Tasks:* Total active, plus the existing green/yellow/red/overdue buckets (`classifyDueStatus`, already built for `TodoList`).
  - *Reviews:* Total active, plus a stale/not-stale breakdown (`isTaskStale`, already built).
  - *Content Ideas:* Total, grouped by client (reusing the existing grouped list shape from `GET /api/content-ideas/all`).
- **Search:** client-side filtering over whatever the active tab already loaded — no new search backend. `GET /api/posting-schedule/due-soon` already fetches and parses the *entire* sheet on every call today (filtering happens after the fetch); the new full-list endpoint changes what's returned, not what's fetched, so this introduces no new cost at the data-source layer. If the sheet ever grows past what's comfortable to filter client-side, that's a later problem, not one this design needs to solve now.
- **Nav:** a link from the existing home page to `/team` (and back) — one line, not a design decision.
- **Tasks/Reviews stay "active, not-snoozed," same as `GET /api/tasks`'s existing default.** A snoozed item is deliberately hidden elsewhere in the app too (until its snooze expires) — that's existing, intentional behavior, not the same gap as the posting-schedule card's 3-day window. No change to `app/api/tasks/route.ts` needed.
- **Posting Schedule's "Done" bucket is the union of both existing done-signals**: a row counts as Done if *either* `postingScheduleCompletions` has it (pressed via the app's own Done button) *or* the sheet's Notes column says "done." "On hold" comes only from the sheet's Notes saying "hold" (nothing else produces that state today). This keeps the stat cards from ever disagreeing with what the existing Done button already shows.
- **Status-dot mapping**, extending the approved mockup's filled/outline/grey principle to the fuller band sets each domain actually has:
  - *Posting Schedule* (5 states once Done/On-hold are added to the existing none/green/red): filled = overdue, outline = due soon (≤3 days), no dot = upcoming (>3 days), grey = done, grey outline = on hold.
  - *Tasks* (5 bands from the existing `classifyDueStatus`: overdue/red/yellow/green/null): filled = overdue, outline = red or yellow (due within 3 days), no dot = green or null (further out or no due date) — collapses the app's own 4-color urgency scheme down to the dashboard's 3-weight one, since this surface is for a glance, not the detailed color-coding `TodoList` already does.
  - *Reviews*: filled = stale (`isTaskStale`), no dot = not stale.
  - This is a cheap display mapping to change later if it doesn't feel right once built — not worth a round-trip to confirm up front.
