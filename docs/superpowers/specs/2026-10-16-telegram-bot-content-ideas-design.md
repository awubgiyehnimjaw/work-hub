# Telegram capture bot + Content Ideas section

## Intent and why

Callum sometimes has a to-do or a content idea come to mind when he's away
from the app (driving, mid-call, etc.) and doesn't want to type. He wants
to message a Telegram bot — by voice or text — and have it land in the
right place in Work Hub automatically: a to-do, or a content idea filed
under a client. This closes the gap between "I thought of something" and
"it's captured," which today requires opening the app and typing.

## Goals

- Send the bot a voice note or a text message, in natural language, that
  states whether it's a to-do or a content idea (and, for an idea, which
  client it's for).
- The bot extracts the type, the client (if applicable), and the content,
  saves it, and replies in the same chat with a one-line confirmation —
  so a misheard client or a wrong guess is obvious immediately, with
  nothing to tap.
- Content ideas get their own section in the app, grouped by client, so
  Callum can scan everything he's dropped in for a client before a
  content day.
- Only Callum's own Telegram account can add anything — no open bot
  anyone could spam.

## Non-goals

- No chat-based editing or deletion ("delete the last idea") — editing
  happens in the app, same as every other section.
- No multi-step conversation with the bot (no "which client did you
  mean?" back-and-forth beyond one clarifying question when parsing
  fails outright).
- No priority, status, or due date on a content idea — it's a running
  list of raw ideas per client, not a second task tracker.
- No support for other Telegram message types (photos, documents,
  stickers) — text and voice only.

## Anti-goals (would make this a failure even if it technically works)

- A voice note getting silently misparsed into the wrong client or the
  wrong type with no visible confirmation — Callum finding out days
  later that three ideas landed under the wrong client defeats the
  point.
- Anyone other than Callum being able to add to his lists by finding or
  guessing the bot's username.
- The bot going silent/erroring with no reply, leaving Callum unsure
  whether his message landed at all.

## Current state

- `lib/db/schema.ts` has `clients` (tag, displayName, recognized,
  lastActivityAt) and `tasks` (type `review`/`todo`, with `todo` rows
  having no client). `POST /api/tasks` already creates a `todo` task
  from `{ title, dueAt? }` — this is reused, not replaced.
- The Clients page (just shipped) is the one place client tags/display
  names are managed, with the known tags: Lovelots, Lesamai, That Place,
  HappyFish, NLD, ARC, Ulti. Callum wants a "content ideas" client
  roster of ARC, Ultimate Intern, LoveLots, That Place, LeSaMai,
  HappyFish, NLD — the same set, with "Ulti" renamed to "Ultimate
  Intern" for display.
- No existing integration touches voice/audio or a chat platform. No
  `OPENAI_API_KEY` or Telegram credentials exist yet.

## Decided (Callum's calls)

- Type and client are stated in the message itself, in natural language
  (e.g. "to do, email the client about delivery" or "content idea for
  ARC, a before-and-after reel") — not picked from buttons.
- The bot replies with a one-line confirmation of what it understood,
  every time (not silent).
- Both voice notes and typed text are accepted; voice is transcribed
  first, then handled identically to typed text.
- The content-ideas client roster reuses the existing Clients list
  (rather than a second, separately-maintained roster) — confirmed set:
  ARC, Ultimate Intern (renamed from Ulti), LoveLots, That Place,
  LeSaMai, HappyFish, NLD.
- A content idea has no status/priority — just text, client, and when it
  was added.
- A bot-added to-do **can** carry a due date: the parser understands
  relative phrasing ("tomorrow", "Friday", "in two hours") the same way
  a natural reminder would be spoken, and sets `dueAt` accordingly. If
  no date is mentioned, `dueAt` is left unset, same as a to-do added
  through the app's own quick-add without touching the date field.
- Logging a content idea does **not** count as client activity — it
  never touches `clients.lastActivityAt`. That field only reflects real
  review work (set by `lib/frameio/poll.ts` today), and it feeds the
  existing "client's gone quiet" growth suggestion; letting a stray idea
  reset that timer would quietly hide the exact client that nudge is
  meant to catch.

## My calls (implementation defaults — flag if you want these different)

- **Telegram integration via webhook, not polling.** Vercel functions
  are stateless/on-demand, so there's nothing to long-poll from; Telegram
  calls `POST /api/telegram/webhook` on every message, same shape as the
  existing `/api/cron/*` and `/api/oauth/*` routes.
- **Security**: the webhook is not behind the app's passcode session
  (Telegram can't do that handshake). Instead: (1) Telegram's own
  per-webhook secret token, checked against the
  `X-Telegram-Bot-Api-Secret-Token` header on every request, and (2) an
  allow-listed `TELEGRAM_ALLOWED_CHAT_ID` — any message from a different
  chat gets a polite "not authorized" reply and nothing is written.
  Mirrors `lib/auth/cron-secret.ts`'s bearer-token pattern.
- **Transcription + parsing: OpenAI**, one new vendor instead of two.
  Voice notes (Telegram delivers Opus/OGG) go to OpenAI's audio
  transcription endpoint; the resulting text (or the original typed
  text) goes to a small OpenAI chat-completion call that returns
  structured JSON: `{ type: "todo" | "content_idea" | "unclear", client:
  string | null, text: string, dueAt: string | null }` — `dueAt` is an
  ISO timestamp resolved from relative phrasing ("tomorrow", "Friday")
  against the message's own received time, `null` when no date is
  mentioned or the type isn't `todo`. One new env var, `OPENAI_API_KEY`.
  I'll confirm the exact audio format handling (whether OGG needs
  converting before the transcription call) while building, not a
  decision Callum needs to weigh in on.
- **`unclear` handling**: if the model can't tell to-do from content
  idea, or (for a content idea) can't match a client with reasonable
  confidence, the bot replies asking Callum to resend it more
  explicitly, rather than guessing or silently dropping it.
- **Data model**: new `content_ideas` table — `id`, `clientId` (FK to
  `clients`, not nullable — every idea belongs to a client), `text`,
  `createdAt`. Inserting a row never touches `clients.lastActivityAt`
  (see above). To-dos from the bot reuse the existing `tasks` table via
  the same creation path `POST /api/tasks` already uses, now also
  passing through a parsed `dueAt` (factored into a shared helper so the
  webhook and the existing route don't duplicate validation).
- **Content Ideas page** (`/ideas`): grouped by client like the History
  page, newest first within each group. Supports manual add/edit/delete
  from the web UI too (same CRUD pattern as Suggestions/Clients) — not
  bot-only, so a quick note can be jotted straight into the app when
  that's more convenient than Telegram.
- **Nav**: a fourth "Ideas →" link added to the dashboard header
  (alongside Clients/Suggestions/History) — the header already wraps on
  narrow screens.

## What's left to the builder

- Exact OpenAI model choice for parsing (a small/cheap chat model is
  plenty for this extraction task) and the transcription model name —
  pick current, cost-appropriate defaults at build time.
- Exact confirmation-message wording and the "unclear" prompt wording.
- Whether the shared to-do-creation helper lives in `lib/tasks/` — name
  and placement are the builder's call, following existing conventions
  (e.g. `lib/clients/stats.ts`, `lib/db/pg-errors.ts`).
- Migration numbering/filename for the new `content_ideas` table,
  following the existing `lib/db/migrations/000N_*.sql` sequence.
- Telegram bot setup is manual, one-time, done together once this is
  approved: Callum creates the bot via @BotFather and gets his own chat
  ID; the resulting token/chat ID/secret are set as Vercel env vars and
  the webhook is registered via one `setWebhook` call — same shape as
  the existing Frame.io/Google OAuth app setup already in
  `docs/superpowers/deploy-notes.md`.
