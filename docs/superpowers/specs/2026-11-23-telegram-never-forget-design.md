# Telegram "Never Forget" System — Design

## Intent

Callum forgets to-dos. The Telegram capture bot already saves a to-do the
moment he texts or voice-notes one, but once saved, a to-do is silent
until he happens to open the app. This adds four behaviors on top of the
existing bot so a to-do actively chases him down on Telegram — the
channel he already lives in — until it's done or he explicitly defers it.

## Goals

- Capture: text or voice to Telegram becomes a to-do immediately (mostly
  already true — confirm/polish only).
- An overdue to-do re-pings Callum on Telegram every 3 hours, with
  one-tap buttons, until he acts — not just a single silent push.
- A 9am SGT "here's today" digest and a 9pm SGT "here's what's still
  open" sweep, each at most once a day.
- All of it stays inside the existing Telegram bot and `check-reminders`
  cron — no new app, no new dependencies, no new cron job.

## Non-Goals / Anti-Goals

- No UI page for dismissed ("dropped") to-dos — dropping one just takes
  it out of the active list, the same as completing one. Surfacing a
  "dropped" history view is a separate, later request if ever wanted.
- No change to the **web push** due-notification behavior
  (`checkDueTodos`/`dueNotifiedAt`) — it still fires once at due time,
  unchanged. Telegram's new nag is additive, not a replacement for push.
- Not building a general Telegram button framework — just enough
  inline-keyboard plumbing for the four button actions this needs
  (Done / Snooze 1h / Tomorrow 9am / Drop).
- Review tasks and content ideas are untouched — this is to-dos only.

## Constraints (from the existing codebase)

- Single-user app; Telegram is the only channel that matters here.
- `TELEGRAM_ALLOWED_CHAT_IDS` (plural) gates which chats the bot *reacts*
  to, and currently includes an employee's chat too — it is **not**
  Callum's personal identifier and must not be reused as one.
- No new dependencies; no new Vercel cron entry — everything rides the
  existing 15-minute `/api/cron/check-reminders` tick, using the same
  "guard timestamp" pattern `maybeSendWeeklyDigest` already uses.
- `lib/telegram/client.ts` only sends plain text today — no inline
  keyboards, no message editing, no callback handling anywhere in the
  webhook.
- `tasks.status` is a 2-value enum (`active`/`completed`) — there is no
  "dismissed" state yet.

## Decisions

**Owner chat ID.** New env var `TELEGRAM_OWNER_CHAT_ID=5835594329`
(Callum's personal chat). Every proactive send in this feature — nags,
morning digest, evening sweep — goes to this one ID, never to
`TELEGRAM_ALLOWED_CHAT_IDS`. Inbound message handling (capture, AI chat)
is untouched and keeps using the existing allow-list.

**Inline keyboards.** Extend `sendMessage` with an optional
`replyMarkup` (Telegram's `inline_keyboard` shape); add `editMessageText`
and `answerCallbackQuery` to `lib/telegram/client.ts`, same request style
as the existing functions there. Callback data is a short pipe-delimited
string, e.g. `td|done|<task-id>`, `td|snooze1h|<task-id>`,
`td|tomorrow|<task-id>`, `td|drop|<task-id>` — well under Telegram's
64-byte limit.

**Webhook gets a second branch.** Today the webhook only reads
`update.message`. It also reads `update.callback_query` now: same
secret-token auth as before, same `isAllowedChatId` check (defensively —
only `TELEGRAM_OWNER_CHAT_ID` is ever sent a button in practice), then
dispatches on the action, edits the original message to show the
outcome (e.g. strike the text and drop the buttons), and calls
`answerCallbackQuery` so Telegram clears the tap's loading spinner.

**Snooze 1h / Tomorrow 9am reuse `snoozedUntil`** — the same column and
`notSnoozed()` filter already used by every "what's active right now"
query in the app (`chat-tools.ts`, `GET /api/tasks`, etc). No change to
`dueAt`. This is deliberate: a to-do snoozed to "tomorrow 9am" still has
its original (past) `dueAt`, so once the snooze lapses it's immediately
overdue again and nagging resumes on its own — exactly "nag until done"
with no extra bookkeeping. "Tomorrow 9am" computes a concrete SGT
timestamp using the existing `sgtDateKey` helper
(`lib/posting-schedule/sheet.ts`) plus one day, same fixed UTC+8
arithmetic the cron already uses for its 9am/Sunday-evening windows.

**Drop adds a third task status: `dismissed`.** A migration adds this
value to the existing `task_status` enum. Dropping sets
`status: "dismissed"` — excluded from every existing "active" query for
free, never deleted.

**Nag tracking.** One new nullable column, `tasks.telegram_nag_sent_at`
(migration), exactly as specified: null means "never nagged"; a nag
fires when null, or when it's been ≥3 hours since the last one. This is
Telegram-only bookkeeping and has no relationship to `dueNotifiedAt`.

**Quiet hours (11pm–8am SGT)** are checked with the same raw
fixed-offset arithmetic `check-reminders` already uses for its windows
(`(now.getUTCHours() + 8) % 24`), not a new timezone library. During
quiet hours the nag check is skipped entirely — it doesn't send and
doesn't touch `telegram_nag_sent_at`, so the next nag after 8am isn't
delayed by the skipped window.

**Morning digest (9am SGT)** lists to-dos due today, already overdue, and
undated active to-dos (title + due time where applicable), skipped
silently if all three are empty. Guarded by a new
`syncState.morning_digest_sent_at` column, same "set it once checked,
whether or not anything was sent" pattern `postingScheduleCheckedAt`
already uses — a quiet morning isn't re-checked for the rest of the day.
9am SGT is the same 01:00 UTC hour the posting-schedule digest already
checks in; they run in the same cron tick with independent guard columns.

**Evening sweep (9pm SGT / 13:00 UTC)** lists unfinished to-dos due today
or overdue. If there's at least one, it sends a short "Still open:"
intro, then one message per to-do (title + status) each with its own
three buttons: ✅ Done, ➡️ Tomorrow, 🗑 Drop. One message per to-do (not
one message with N rows of buttons) because Telegram has no way to show
which button-row belongs to which list line — this keeps every button
unambiguous, and reuses the same "send a to-do with action buttons"
function the nag uses, just with a different button set and no repeat
interval. Guarded by its own new `syncState.evening_sweep_sent_at`
column, same once-a-day pattern.

**Capture (item 1).** Already live via the existing
`parseCaptureMessage` → `createTodo` path (including voice
transcription) — this is confirmed working, not new. The only possible
tweak is confirmation wording to match "Got it ✅ — <task>, due <time>"
exactly if Callum wants that specific phrasing; otherwise the existing
"✅ To-do added: <title> (due <time>)" stays as-is.

## What's Left to the Builder

- Exact SQL for the enum-value addition and the two new columns,
  following the existing migration files' own conventions.
- Exact Telegram message copy for the nag / digest / sweep text (short,
  matching the existing bot's tone — see `chat-handler.ts`'s system
  prompt and the webhook's existing confirmation strings).
- Whether the nag/sweep per-to-do message also includes the due time
  inline (yes — same `formatLocalDateTime` already used in the webhook).
- Test coverage per the user's own list: time parsing (already covered
  by existing `parseCaptureMessage` tests — confirm, don't re-test),
  nag interval + quiet hours, digest/sweep once-per-day guards, and
  callback button handling (completing, snoozing, dropping, and the
  message edit/answerCallbackQuery calls).
