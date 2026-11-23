# Telegram "Never Forget" System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make overdue to-dos actively chase Callum on Telegram (3-hourly nags with action buttons) and add a 9am "here's today" digest and a 9pm "still open" sweep, all riding the existing capture bot and reminder cron.

**Architecture:** Four additive pieces bolted onto the existing Telegram bot: (1) a schema migration adding one `tasks` column, one new enum value, and two `syncState` columns; (2) three new functions on `lib/telegram/client.ts` for inline keyboards, message editing, and the owner chat id; (3) two new one-function task-mutation files mirroring the existing `lib/tasks/complete.ts` convention; (4) three new check functions in `lib/reminders/check.ts` (nag, morning digest, evening sweep) following `maybeSendPostingScheduleDigest`'s exact once-per-window pattern, wired into the existing `check-reminders` cron route; (5) a new `callback_query` branch in the Telegram webhook, handled by a new `lib/telegram/callback-handler.ts`.

**Tech Stack:** Next.js 15 App Router, TypeScript, Drizzle ORM / Neon Postgres (PGlite in tests), vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-23-telegram-never-forget-design.md`

## Global Constraints

- No new dependencies; no new Vercel/GitHub Actions cron entry — everything rides the existing 15-minute `/api/cron/check-reminders` tick.
- New env var `TELEGRAM_OWNER_CHAT_ID=5835594329` — every proactive send in this feature (nag, morning digest, evening sweep) targets this id exclusively, **never** `TELEGRAM_ALLOWED_CHAT_IDS` (which includes an employee's chat and gates inbound messages only).
- Quiet hours are 23:00–08:00 SGT, computed as `const sgtHour = (now.getUTCHours() + 8) % 24; sgtHour >= 23 || sgtHour < 8` — no timezone library.
- Morning digest window: 9am SGT = `01:00 UTC` (same hour `maybeSendPostingScheduleDigest` already checks). Evening sweep window: 9pm SGT = `13:00 UTC`.
- Nag interval is 3 hours, tracked by a new nullable `tasks.telegram_nag_sent_at` column, independent of `dueNotifiedAt` (the existing web-push "due" notification, which this feature never touches).
- "Snooze 1h" and "Tomorrow" (both the nag's "Tomorrow 9am" and the sweep's "➡️ Tomorrow" are the same action) set `tasks.snoozedUntil` only — never `dueAt`. All three new check functions (nag, morning digest, evening sweep) must filter candidates the same way every existing "what's active right now" query does: `status = "active"` and not currently snoozed (`snoozedUntil IS NULL OR snoozedUntil <= now`) — this is what makes the Snooze/Tomorrow buttons actually suppress the nag/sweep.
- "Drop" sets `tasks.status = "dismissed"` — a new third value on the existing 2-value `task_status` enum. Never a hard delete.
- Callback data format (Telegram's 64-byte `callback_data` limit): `td|<action>|<taskId>` where `action` is one of `done`, `snooze1h`, `tomorrow`, `drop`.
- Capture (text/voice → to-do) is already live via the existing `parseCaptureMessage` → `createTodo` path and needs no new task here.

## Review Focus

- **Dismissed to-dos leaking back into any of the three new queries.** `dismissed` is a brand-new status; a query written as `status !== "completed"` instead of `status === "active"` would silently resurrect a dropped to-do in the next nag or sweep. Each of Task 5/7/8's tests must include a dismissed to-do and assert it's excluded.
- **A stale button press** — Callum taps a nag/sweep button for a to-do that was already completed/dismissed/snoozed by the time the tap arrives (double-tap, or he finished it in the app first). `completeTask`/`snoozeTask`/`dismissTask` all succeed on an existing id regardless of its current status, so this must not crash or send a misleading "it's all set!" when nothing meaningfully changed — Task 6's tests cover this explicitly.
- **`tomorrowNineAmSgt` across a month/year boundary** (e.g. computed on Dec 31) — must roll over correctly via `Date.UTC`'s own overflow handling, pinned by a test, not assumed.
- **`TELEGRAM_OWNER_CHAT_ID` unset or non-numeric** — every proactive function must fail loudly (throw), never silently no-op and never fall back to iterating `TELEGRAM_ALLOWED_CHAT_IDS`, which would leak "still open" nags to the employee's chat.
- **A malformed or unrecognized `callback_data`** (a stale button from a future format change, or a corrupted payload) must not crash the webhook — it answers the callback and logs, same fail-closed-but-200 contract the webhook already documents for everything else.

---

### Task 1: Schema — nag column, dismissed status, digest guard columns

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0012_add_telegram_nag_system.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `tasks.telegramNagSentAt: timestamp | null`; `taskStatusEnum` third value `"dismissed"`; `syncState.morningDigestSentAt: timestamp | null`; `syncState.eveningSweepSentAt: timestamp | null`. Every later task's Drizzle queries and `typeof tasks.$inferSelect` / `typeof syncState.$inferSelect` types rely on these.

- [ ] **Step 1: Edit `lib/db/schema.ts`**

In `taskStatusEnum`, add `"dismissed"` as the third value (`pgEnum("task_status", ["active", "completed", "dismissed"])`). On the `tasks` table, add `telegramNagSentAt: timestamp("telegram_nag_sent_at")` (nullable, same style as `dueNotifiedAt`). On the `syncState` table, add `morningDigestSentAt: timestamp("morning_digest_sent_at")` and `eveningSweepSentAt: timestamp("evening_sweep_sent_at")` (nullable, same style as `weeklyDigestSentAt`).

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `lib/db/migrations/0012_*.sql` is created containing an `ALTER TYPE "public"."task_status" ADD VALUE 'dismissed';` statement and three `ALTER TABLE ... ADD COLUMN ... timestamp;` statements, and `lib/db/migrations/meta/_journal.json` gains a matching entry. Rename the generated file to `0012_add_telegram_nag_system.sql` if drizzle-kit picks a different auto-generated name, and update the journal's `tag` to match.

- [ ] **Step 3: Verify the migration applies cleanly**

Run: `npm test`
Expected: the full existing suite still passes (472+ tests, 0 failures) — the test DB is a fresh in-memory PGlite migrated from `lib/db/migrations` on every run, so a broken migration file fails the entire suite immediately.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0012_add_telegram_nag_system.sql lib/db/migrations/meta/_journal.json
git commit -m "feat: add schema for telegram nag system"
```

---

### Task 2: Telegram client — inline keyboards, message editing, owner chat id

**Files:**
- Modify: `lib/telegram/client.ts`
- Test: `tests/telegram/client.test.ts`

**Interfaces:**
- Produces:
  - `export interface InlineKeyboardButton { text: string; callback_data: string; }`
  - `export type InlineKeyboard = InlineKeyboardButton[][];`
  - `export async function sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void>` — extends the existing function; when `replyMarkup` is omitted the request body is unchanged from today (no `reply_markup` key at all), so every existing caller and existing test keeps passing untouched.
  - `export async function editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void>` — posts to Telegram's `editMessageText`; when `replyMarkup` is `[]`, sends `reply_markup: { inline_keyboard: [] }` (clears existing buttons); when omitted, sends no `reply_markup` key (Telegram leaves the existing keyboard as-is).
  - `export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>` — posts to Telegram's `answerCallbackQuery`.
  - `export function getOwnerChatId(): number` — reads `TELEGRAM_OWNER_CHAT_ID`, throws `Error` if unset or if `Number(...)` is `NaN`.

- [ ] **Step 1: Write the failing tests**

```typescript
test("sendMessage includes reply_markup when buttons are passed", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await sendMessage(123, "hello", [[{ text: "✅ Done", callback_data: "td|done|abc" }]]);
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({
    chat_id: 123,
    text: "hello",
    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "td|done|abc" }]] },
  });
});

test("editMessageText with an empty keyboard clears existing buttons", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await editMessageText(123, 456, "done", []);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/editMessageText");
  expect(JSON.parse(init.body)).toEqual({
    chat_id: 123,
    message_id: 456,
    text: "done",
    reply_markup: { inline_keyboard: [] },
  });
});

test("editMessageText without replyMarkup omits reply_markup entirely", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  await editMessageText(123, 456, "hello");
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)).toEqual({ chat_id: 123, message_id: 456, text: "hello" });
});

test("answerCallbackQuery posts the callback query id", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await answerCallbackQuery("cb-1", "Done");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/answerCallbackQuery");
  expect(JSON.parse(init.body)).toEqual({ callback_query_id: "cb-1", text: "Done" });
});

test("getOwnerChatId returns the numeric chat id", () => {
  process.env.TELEGRAM_OWNER_CHAT_ID = "5835594329";
  expect(getOwnerChatId()).toBe(5835594329);
});

test("getOwnerChatId throws when unset", () => {
  delete process.env.TELEGRAM_OWNER_CHAT_ID;
  expect(() => getOwnerChatId()).toThrow("TELEGRAM_OWNER_CHAT_ID");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram/client.test.ts`
Expected: FAIL — `editMessageText`, `answerCallbackQuery`, `getOwnerChatId` are not exported; `sendMessage` doesn't accept a third argument.

- [ ] **Step 3: Implement in `lib/telegram/client.ts`**

Add the `InlineKeyboardButton`/`InlineKeyboard` types. Extend `sendMessage`'s body construction: build the body object with `chat_id`/`text` first, then spread in `reply_markup: { inline_keyboard: replyMarkup }` only `if (replyMarkup !== undefined)`. Add `editMessageText` and `answerCallbackQuery` following `sendMessage`'s exact existing structure (same `requireEnv`, same `!response.ok` throw). Add `getOwnerChatId` reading `process.env.TELEGRAM_OWNER_CHAT_ID` directly (not through `requireEnv`, whose type is narrowly `"TELEGRAM_BOT_TOKEN"` — leave that function untouched).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram/client.test.ts`
Expected: PASS, all tests including the pre-existing ones in this file.

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/client.ts tests/telegram/client.test.ts
git commit -m "feat: add inline keyboard, message editing, and owner chat id to telegram client"
```

---

### Task 3: Task action helpers — snooze and dismiss

**Files:**
- Create: `lib/tasks/snooze.ts`
- Create: `lib/tasks/dismiss.ts`
- Test: `tests/tasks/snooze.test.ts`
- Test: `tests/tasks/dismiss.test.ts`

**Interfaces:**
- Produces: `export async function snoozeTask(id: string, until: Date): Promise<typeof tasks.$inferSelect | null>`; `export async function dismissTask(id: string): Promise<typeof tasks.$inferSelect | null>`. Both return `null` for an unknown id, exactly mirroring `completeTask`'s existing contract in `lib/tasks/complete.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tasks/snooze.test.ts
test("snoozeTask sets snoozedUntil and leaves dueAt untouched", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date("2026-01-01T00:00:00Z") }).returning();
  const until = new Date("2026-01-02T01:00:00Z");
  const result = await snoozeTask(task.id, until);
  expect(result?.snoozedUntil).toEqual(until);
  expect(result?.dueAt).toEqual(new Date("2026-01-01T00:00:00Z"));
});

test("snoozeTask returns null for an unknown id", async () => {
  expect(await snoozeTask(randomUUID(), new Date())).toBeNull();
});
```

```typescript
// tests/tasks/dismiss.test.ts
test("dismissTask sets status to dismissed", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active" }).returning();
  const result = await dismissTask(task.id);
  expect(result?.status).toBe("dismissed");
});

test("dismissTask returns null for an unknown id", async () => {
  expect(await dismissTask(randomUUID())).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tasks/snooze.test.ts tests/tasks/dismiss.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement `snoozeTask` and `dismissTask`**

Each is a single `db.update(tasks).set(...).where(eq(tasks.id, id)).returning()`, destructuring the first (only) row and returning it or `null`, exactly matching `lib/tasks/complete.ts`'s existing shape (no `clients.lastActivityAt` side effect — that's specific to completing a review task).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tasks/snooze.test.ts tests/tasks/dismiss.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/tasks/snooze.ts lib/tasks/dismiss.ts tests/tasks/snooze.test.ts tests/tasks/dismiss.test.ts
git commit -m "feat: add snoozeTask and dismissTask helpers"
```

---

### Task 4: SGT time helpers

**Files:**
- Create: `lib/reminders/sgt-time.ts`
- Test: `tests/reminders/sgt-time.test.ts`

**Interfaces:**
- Consumes: `sgtDateKey(date: Date): string` from `lib/posting-schedule/sheet.ts` (already exported).
- Produces: `export function isQuietHoursSgt(now: Date): boolean`; `export function tomorrowNineAmSgt(now: Date): Date`; `export function startOfTomorrowSgt(now: Date): Date` (midnight SGT at the start of the next SGT calendar day — the boundary between "due today" and "overdue" for Tasks 7/8).

- [ ] **Step 1: Write the failing tests**

```typescript
test("isQuietHoursSgt is true at 11:30pm SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-01T15:30:00Z"))).toBe(true); // 23:30 SGT
});
test("isQuietHoursSgt is true at 7:30am SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-01T23:30:00Z"))).toBe(true); // 07:30 SGT
});
test("isQuietHoursSgt is false at 8:00am SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-02T00:00:00Z"))).toBe(false); // 08:00 SGT
});
test("isQuietHoursSgt is false at noon SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-01T04:00:00Z"))).toBe(false); // 12:00 SGT
});

test("tomorrowNineAmSgt returns 9am SGT the next SGT calendar day", () => {
  // 2026-01-01T10:00:00Z = 2026-01-01 18:00 SGT
  expect(tomorrowNineAmSgt(new Date("2026-01-01T10:00:00Z"))).toEqual(new Date("2026-01-02T01:00:00Z"));
});
test("tomorrowNineAmSgt rolls over across a year boundary", () => {
  // 2025-12-31 18:00 SGT
  expect(tomorrowNineAmSgt(new Date("2025-12-31T10:00:00Z"))).toEqual(new Date("2026-01-01T01:00:00Z"));
});

test("startOfTomorrowSgt returns midnight SGT the next SGT calendar day", () => {
  expect(startOfTomorrowSgt(new Date("2026-01-01T10:00:00Z"))).toEqual(new Date("2026-01-01T16:00:00Z"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reminders/sgt-time.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `lib/reminders/sgt-time.ts`**

`isQuietHoursSgt`: `const sgtHour = (now.getUTCHours() + 8) % 24; return sgtHour >= 23 || sgtHour < 8;`. `tomorrowNineAmSgt` and `startOfTomorrowSgt`: parse `sgtDateKey(now)` (format `YYYY-MM-DD`) into `year`/`month`/`day` numbers, then `new Date(Date.UTC(year, month - 1, day + 1, 1, 0, 0))` (9am SGT = 01:00 UTC) and `new Date(Date.UTC(year, month - 1, day, 16, 0, 0))` (midnight SGT tomorrow = 16:00 UTC today) respectively — `Date.UTC` normalizes an out-of-range `day + 1` across month/year boundaries on its own.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reminders/sgt-time.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/sgt-time.ts tests/reminders/sgt-time.test.ts
git commit -m "feat: add SGT quiet-hours and date-boundary helpers"
```

---

### Task 5: Nag message composer and overdue-nag check

**Files:**
- Create: `lib/telegram/todo-messages.ts`
- Modify: `lib/reminders/check.ts`
- Test: `tests/telegram/todo-messages.test.ts`
- Test: `tests/reminders/check.test.ts` (extend)

**Interfaces:**
- Consumes: `sendMessage`, `getOwnerChatId` from `lib/telegram/client.ts` (Task 2); `isQuietHoursSgt` from `lib/reminders/sgt-time.ts` (Task 4); `formatLocalDateTime` from `lib/groq/client.ts` (existing).
- Produces: `export async function sendNagMessage(chatId: number, task: { id: string; title: string; dueAt: Date | null }): Promise<void>` in `lib/telegram/todo-messages.ts` — sends the to-do's title and due time with three buttons (`✅ Done` → `td|done|<id>`, `⏰ Snooze 1h` → `td|snooze1h|<id>`, `📅 Tomorrow 9am` → `td|tomorrow|<id>`). `export async function checkOverdueTodoNags(now: Date): Promise<{ notified: number }>` in `lib/reminders/check.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/telegram/todo-messages.test.ts
vi.mock("@/lib/telegram/client", () => ({ sendMessage: vi.fn().mockResolvedValue(undefined) }));
test("sendNagMessage sends the title and three action buttons", async () => {
  await sendNagMessage(123, { id: "task-1", title: "Call the client", dueAt: new Date("2026-01-01T06:00:00Z") });
  const [chatId, text, buttons] = vi.mocked(sendMessage).mock.calls[0];
  expect(chatId).toBe(123);
  expect(text).toContain("Call the client");
  expect(buttons).toEqual([[
    { text: "✅ Done", callback_data: "td|done|task-1" },
    { text: "⏰ Snooze 1h", callback_data: "td|snooze1h|task-1" },
    { text: "📅 Tomorrow 9am", callback_data: "td|tomorrow|task-1" },
  ]]);
});
```

```typescript
// tests/reminders/check.test.ts additions
vi.mock("@/lib/telegram/todo-messages", () => ({ sendNagMessage: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => { process.env.TELEGRAM_OWNER_CHAT_ID = "999"; });

test("checkOverdueTodoNags nags an overdue to-do that's never been nagged", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date(Date.now() - 60_000) }).returning();
  const result = await checkOverdueTodoNags(new Date());
  expect(result).toEqual({ notified: 1 });
  expect(vi.mocked(sendNagMessage)).toHaveBeenCalledWith(999, expect.objectContaining({ id: task.id }));
  const [row] = await db.select().from(tasks);
  expect(row.telegramNagSentAt).not.toBeNull();
});

test("checkOverdueTodoNags skips a to-do nagged less than 3 hours ago", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date(Date.now() - 60_000), telegramNagSentAt: new Date(Date.now() - 60 * 60 * 1000) });
  expect(await checkOverdueTodoNags(new Date())).toEqual({ notified: 0 });
});

test("checkOverdueTodoNags re-nags a to-do last nagged over 3 hours ago", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date(Date.now() - 60_000), telegramNagSentAt: new Date(Date.now() - 4 * 60 * 60 * 1000) });
  expect(await checkOverdueTodoNags(new Date())).toEqual({ notified: 1 });
});

test("checkOverdueTodoNags does not nag during quiet hours and leaves telegramNagSentAt untouched", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date("2026-01-01T00:00:00Z") });
  const quietNow = new Date("2026-01-01T16:00:00Z"); // midnight SGT
  expect(await checkOverdueTodoNags(quietNow)).toEqual({ notified: 0 });
  const [row] = await db.select().from(tasks);
  expect(row.telegramNagSentAt).toBeNull();
});

test("checkOverdueTodoNags skips a snoozed to-do", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date(Date.now() - 60_000), snoozedUntil: new Date(Date.now() + 60 * 60 * 1000) });
  expect(await checkOverdueTodoNags(new Date())).toEqual({ notified: 0 });
});

test("checkOverdueTodoNags skips a dismissed to-do even if overdue", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "dismissed", dueAt: new Date(Date.now() - 60_000) });
  expect(await checkOverdueTodoNags(new Date())).toEqual({ notified: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram/todo-messages.test.ts tests/reminders/check.test.ts`
Expected: FAIL — `sendNagMessage`/`checkOverdueTodoNags` don't exist.

- [ ] **Step 3: Implement `sendNagMessage` and `checkOverdueTodoNags`**

`sendNagMessage`: compose text as `"⏰ Overdue: <title>" + (dueAt ? " (due " + formatLocalDateTime(dueAt) + ")" : "")`, call `sendMessage` with the three-button row above. `checkOverdueTodoNags(now)`: if `isQuietHoursSgt(now)` return `{ notified: 0 }` immediately (no query, no column write). Otherwise query `tasks` for `type: "todo"`, `status: "active"`, `dueAt` not null and `<= now`, not snoozed (`or(isNull(snoozedUntil), lte(snoozedUntil, now))`), and `or(isNull(telegramNagSentAt), lte(telegramNagSentAt, new Date(now.getTime() - 3 * 60 * 60 * 1000)))`. For each candidate, call `sendNagMessage(getOwnerChatId(), task)` then `db.update(tasks).set({ telegramNagSentAt: now }).where(eq(tasks.id, task.id))`; return `{ notified: candidates.length }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram/todo-messages.test.ts tests/reminders/check.test.ts`
Expected: PASS, all tests in both files (including pre-existing ones in `check.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/todo-messages.ts lib/reminders/check.ts tests/telegram/todo-messages.test.ts tests/reminders/check.test.ts
git commit -m "feat: add overdue to-do nag check"
```

---

### Task 6: Callback query handling

**Files:**
- Create: `lib/telegram/callback-handler.ts`
- Modify: `app/api/telegram/webhook/route.ts`
- Test: `tests/telegram/callback-handler.test.ts`
- Test: `tests/api/telegram-webhook.test.ts` (extend)

**Interfaces:**
- Consumes: `editMessageText`, `answerCallbackQuery` from `lib/telegram/client.ts` (Task 2); `completeTask` from `lib/tasks/complete.ts` (existing); `snoozeTask`, `dismissTask` from Task 3; `tomorrowNineAmSgt` from Task 4; callback data format `td|<action>|<taskId>` (Global Constraints).
- Produces: `export async function handleCallbackQuery(chatId: number, messageId: number, callbackQueryId: string, data: string, now: Date): Promise<void>` in `lib/telegram/callback-handler.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/telegram/callback-handler.test.ts
vi.mock("@/lib/telegram/client", () => ({ editMessageText: vi.fn().mockResolvedValue(undefined), answerCallbackQuery: vi.fn().mockResolvedValue(undefined) }));

test("done action completes the task and clears the buttons", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "Call client", status: "active" }).returning();
  await handleCallbackQuery(123, 456, "cb-1", `td|done|${task.id}`, new Date());
  const [row] = await db.select().from(tasks);
  expect(row.status).toBe("completed");
  expect(vi.mocked(editMessageText)).toHaveBeenCalledWith(123, 456, expect.stringContaining("Done"), []);
  expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalledWith("cb-1");
});

test("snooze1h action snoozes the task 1 hour from now", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active" }).returning();
  const now = new Date("2026-01-01T10:00:00Z");
  await handleCallbackQuery(123, 456, "cb-1", `td|snooze1h|${task.id}`, now);
  const [row] = await db.select().from(tasks);
  expect(row.snoozedUntil).toEqual(new Date("2026-01-01T11:00:00Z"));
});

test("tomorrow action snoozes the task to 9am SGT the next day", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active" }).returning();
  await handleCallbackQuery(123, 456, "cb-1", `td|tomorrow|${task.id}`, new Date("2026-01-01T10:00:00Z"));
  const [row] = await db.select().from(tasks);
  expect(row.snoozedUntil).toEqual(new Date("2026-01-02T01:00:00Z"));
});

test("drop action dismisses the task", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active" }).returning();
  await handleCallbackQuery(123, 456, "cb-1", `td|drop|${task.id}`, new Date());
  const [row] = await db.select().from(tasks);
  expect(row.status).toBe("dismissed");
});

test("a stale action on an already-completed task edits the message without crashing", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "completed", completedAt: new Date() }).returning();
  await expect(handleCallbackQuery(123, 456, "cb-1", `td|done|${task.id}`, new Date())).resolves.not.toThrow();
  expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalled();
});

test("an unknown action answers the callback and does not throw", async () => {
  await expect(handleCallbackQuery(123, 456, "cb-1", "td|bogus|x", new Date())).resolves.not.toThrow();
  expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalled();
});

test("an action on a nonexistent task id edits the message to say it couldn't be found", async () => {
  await handleCallbackQuery(123, 456, "cb-1", `td|done|${randomUUID()}`, new Date());
  expect(vi.mocked(editMessageText)).toHaveBeenCalledWith(123, 456, expect.stringMatching(/couldn't find|not found/i), []);
});
```

```typescript
// tests/api/telegram-webhook.test.ts additions — extend the existing
// vi.mock("@/lib/telegram/client", ...) to also export editMessageText
// and answerCallbackQuery mocks, and vi.mock("@/lib/telegram/callback-handler")
test("a callback_query update is routed to handleCallbackQuery", async () => {
  const update = {
    update_id: 999,
    callback_query: { id: "cb-1", data: "td|done|task-1", message: { message_id: 42, chat: { id: allowedChatId } } },
  };
  const response = await POST(requestWith(update));
  expect(response.status).toBe(200);
  expect(vi.mocked(handleCallbackQuery)).toHaveBeenCalledWith(allowedChatId, 42, "cb-1", "td|done|task-1", expect.any(Date));
});

test("a callback_query from a disallowed chat is ignored", async () => {
  const update = { update_id: 998, callback_query: { id: "cb-2", data: "td|done|task-1", message: { message_id: 1, chat: { id: 1 } } } };
  await POST(requestWith(update));
  expect(vi.mocked(handleCallbackQuery)).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram/callback-handler.test.ts tests/api/telegram-webhook.test.ts`
Expected: FAIL — `handleCallbackQuery` doesn't exist; the webhook doesn't read `callback_query`.

- [ ] **Step 3: Implement `handleCallbackQuery`**

Split `data` on `"|"`. If the first segment isn't `"td"` or the action isn't one of the four known actions, call `answerCallbackQuery(callbackQueryId)` and return. Otherwise dispatch: `done` → `completeTask(taskId, now)`; `snooze1h` → `snoozeTask(taskId, new Date(now.getTime() + 60 * 60 * 1000))`; `tomorrow` → `snoozeTask(taskId, tomorrowNineAmSgt(now))`; `drop` → `dismissTask(taskId)`. If the result is `null`, `editMessageText(chatId, messageId, "Couldn't find that to-do — it may already have been handled.", [])`; otherwise build a short confirmation (`"✅ Done — <title>"`, `"⏰ Snoozed 1 hour."`, `"📅 Snoozed to tomorrow 9am."`, `"🗑 Dropped."`) and call `editMessageText(chatId, messageId, confirmation, [])`. Always finish with `answerCallbackQuery(callbackQueryId)`.

**Step 3b: Wire the webhook route**

In `app/api/telegram/webhook/route.ts`: extend `TelegramUpdate` with `callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } }`. After the existing secret check, branch: if `update.callback_query` is present, read `chatId` from `callback_query.message.chat.id`; if missing data/message or `!isAllowedChatId(chatId)`, return the existing `{ status: "ignored" }` 200 response; otherwise call `handleCallbackQuery(chatId, callback_query.message.message_id, callback_query.id, callback_query.data, new Date())` inside a try/catch that logs on failure (same style as the existing message-handling try/catch), then return `{ status: "ok" }`. This branch runs instead of the existing `message` handling, not in addition to it — the de-dup insert above already applies to both update kinds since it only reads `update_id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram/callback-handler.test.ts tests/api/telegram-webhook.test.ts`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/callback-handler.ts app/api/telegram/webhook/route.ts tests/telegram/callback-handler.test.ts tests/api/telegram-webhook.test.ts
git commit -m "feat: handle telegram inline-button callback queries"
```

---

### Task 7: Morning digest

**Files:**
- Modify: `lib/reminders/check.ts`
- Test: `tests/reminders/check.test.ts` (extend)

**Interfaces:**
- Consumes: `sendMessage`, `getOwnerChatId` from `lib/telegram/client.ts`; `startOfTomorrowSgt` from `lib/reminders/sgt-time.ts`; `formatLocalDateTime` from `lib/groq/client.ts`.
- Produces: `export async function maybeSendMorningDigest(now: Date): Promise<{ sent: boolean }>`.

- [ ] **Step 1: Write the failing tests**

```typescript
test("maybeSendMorningDigest sends due-today, overdue, and undated active to-dos in the 9am SGT window", async () => {
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  const windowNow = new Date("2026-01-01T01:00:00Z"); // 9am SGT
  await db.insert(tasks).values([
    { type: "todo", title: "Overdue one", status: "active", dueAt: new Date("2025-12-31T00:00:00Z") },
    { type: "todo", title: "Due today", status: "active", dueAt: new Date("2026-01-01T10:00:00Z") },
    { type: "todo", title: "No date", status: "active", dueAt: null },
    { type: "todo", title: "Done already", status: "completed", dueAt: new Date("2025-12-31T00:00:00Z") },
    { type: "todo", title: "Dropped", status: "dismissed", dueAt: new Date("2025-12-31T00:00:00Z") },
  ]);
  const result = await maybeSendMorningDigest(windowNow);
  expect(result).toEqual({ sent: true });
  const [, body] = vi.mocked(sendMessage).mock.calls[0];
  expect(body).toContain("Overdue one");
  expect(body).toContain("Due today");
  expect(body).toContain("No date");
  expect(body).not.toContain("Done already");
  expect(body).not.toContain("Dropped");
});

test("maybeSendMorningDigest is silent, but still marks the day checked, when nothing is due", async () => {
  const result = await maybeSendMorningDigest(new Date("2026-01-01T01:00:00Z"));
  expect(result).toEqual({ sent: false });
  expect(sendMessage).not.toHaveBeenCalled();
});

test("maybeSendMorningDigest only fires once per day", async () => {
  const now = new Date("2026-01-01T01:00:00Z");
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: null });
  await maybeSendMorningDigest(now);
  vi.mocked(sendMessage).mockClear();
  await maybeSendMorningDigest(new Date("2026-01-01T01:10:00Z"));
  expect(sendMessage).not.toHaveBeenCalled();
});

test("maybeSendMorningDigest excludes a snoozed to-do", async () => {
  await db.insert(tasks).values({ type: "todo", title: "Snoozed", status: "active", dueAt: null, snoozedUntil: new Date(Date.now() + 60_000) });
  const [, body] = (await (async () => { await maybeSendMorningDigest(new Date("2026-01-01T01:00:00Z")); return vi.mocked(sendMessage).mock.calls[0] ?? [undefined, ""]; })());
  expect(body).not.toContain("Snoozed");
});

test("maybeSendMorningDigest does nothing outside the 9am SGT window", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: null });
  expect(await maybeSendMorningDigest(new Date("2026-01-01T10:00:00Z"))).toEqual({ sent: false });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/reminders/check.test.ts`
Expected: FAIL — `maybeSendMorningDigest` doesn't exist.

- [ ] **Step 3: Implement `maybeSendMorningDigest`**

Follow `maybeSendPostingScheduleDigest`'s exact shape: a `MORNING_DIGEST_WINDOW_UTC = 1` hour check (reuse the window check pattern, new guard column); if outside the window or already checked today (`syncState.morningDigestSentAt` within the last ~20 hours, same `TWENTY_HOURS_MS` constant already in this file), return `{ sent: false }`. Otherwise query active, not-snoozed `type: "todo"` tasks three ways — overdue (`dueAt <= now`), due today (`dueAt > now && dueAt < startOfTomorrowSgt(now)`), undated (`isNull(dueAt)`) — set `morningDigestSentAt: now` right after the queries (before checking if all three are empty, mirroring the posting-schedule digest's "set it whether or not anything was sent" comment), and if all three are empty return `{ sent: false }` with no send. Otherwise compose one message (each to-do's title, with `formatLocalDateTime(dueAt)` where it has one) and `sendMessage(getOwnerChatId(), body)`; return `{ sent: true }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/reminders/check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/reminders/check.ts tests/reminders/check.test.ts
git commit -m "feat: add 9am SGT morning digest"
```

---

### Task 8: Evening sweep

**Files:**
- Modify: `lib/telegram/todo-messages.ts`
- Modify: `lib/reminders/check.ts`
- Test: `tests/telegram/todo-messages.test.ts` (extend)
- Test: `tests/reminders/check.test.ts` (extend)

**Interfaces:**
- Consumes: `sendMessage`, `getOwnerChatId` from `lib/telegram/client.ts`; `startOfTomorrowSgt` from `lib/reminders/sgt-time.ts`.
- Produces: `export async function sendSweepItemMessage(chatId: number, task: { id: string; title: string; dueAt: Date | null }): Promise<void>` in `lib/telegram/todo-messages.ts` (buttons: `✅ Done` → `td|done|<id>`, `➡️ Tomorrow` → `td|tomorrow|<id>`, `🗑 Drop` → `td|drop|<id>`); `export async function maybeSendEveningSweep(now: Date): Promise<{ sent: boolean }>` in `lib/reminders/check.ts`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/telegram/todo-messages.test.ts addition
test("sendSweepItemMessage sends the title and three sweep buttons", async () => {
  await sendSweepItemMessage(123, { id: "task-1", title: "Call client", dueAt: null });
  const [, text, buttons] = vi.mocked(sendMessage).mock.calls[0];
  expect(text).toContain("Call client");
  expect(buttons).toEqual([[
    { text: "✅ Done", callback_data: "td|done|task-1" },
    { text: "➡️ Tomorrow", callback_data: "td|tomorrow|task-1" },
    { text: "🗑 Drop", callback_data: "td|drop|task-1" },
  ]]);
});
```

```typescript
// tests/reminders/check.test.ts additions
vi.mock("@/lib/telegram/todo-messages", () => ({ sendNagMessage: vi.fn().mockResolvedValue(undefined), sendSweepItemMessage: vi.fn().mockResolvedValue(undefined) }));

test("maybeSendEveningSweep sends an intro and one message per unfinished to-do due today or overdue", async () => {
  process.env.TELEGRAM_OWNER_CHAT_ID = "999";
  const now = new Date("2026-01-01T13:00:00Z"); // 9pm SGT
  const [overdue] = await db.insert(tasks).values({ type: "todo", title: "Overdue", status: "active", dueAt: new Date("2025-12-31T00:00:00Z") }).returning();
  const [dueToday] = await db.insert(tasks).values({ type: "todo", title: "Due today", status: "active", dueAt: new Date("2026-01-01T10:00:00Z") }).returning();
  await db.insert(tasks).values({ type: "todo", title: "Undated", status: "active", dueAt: null });
  await db.insert(tasks).values({ type: "todo", title: "Dropped", status: "dismissed", dueAt: new Date("2025-12-31T00:00:00Z") });

  const result = await maybeSendEveningSweep(now);

  expect(result).toEqual({ sent: true });
  expect(sendMessage).toHaveBeenCalledWith(999, expect.stringContaining("Still open"));
  expect(vi.mocked(sendSweepItemMessage)).toHaveBeenCalledWith(999, expect.objectContaining({ id: overdue.id }));
  expect(vi.mocked(sendSweepItemMessage)).toHaveBeenCalledWith(999, expect.objectContaining({ id: dueToday.id }));
  expect(vi.mocked(sendSweepItemMessage)).toHaveBeenCalledTimes(2); // not the undated or dropped one
});

test("maybeSendEveningSweep sends nothing when there's nothing unfinished due today or overdue", async () => {
  const result = await maybeSendEveningSweep(new Date("2026-01-01T13:00:00Z"));
  expect(result).toEqual({ sent: false });
  expect(sendMessage).not.toHaveBeenCalled();
  expect(sendSweepItemMessage).not.toHaveBeenCalled();
});

test("maybeSendEveningSweep only fires once per day", async () => {
  const now = new Date("2026-01-01T13:00:00Z");
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date("2025-12-31T00:00:00Z") });
  await maybeSendEveningSweep(now);
  vi.mocked(sendSweepItemMessage).mockClear();
  await maybeSendEveningSweep(new Date("2026-01-01T13:10:00Z"));
  expect(sendSweepItemMessage).not.toHaveBeenCalled();
});

test("maybeSendEveningSweep excludes a snoozed to-do", async () => {
  await db.insert(tasks).values({ type: "todo", title: "x", status: "active", dueAt: new Date("2025-12-31T00:00:00Z"), snoozedUntil: new Date(Date.now() + 60_000) });
  expect(await maybeSendEveningSweep(new Date("2026-01-01T13:00:00Z"))).toEqual({ sent: false });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/telegram/todo-messages.test.ts tests/reminders/check.test.ts`
Expected: FAIL — `sendSweepItemMessage`/`maybeSendEveningSweep` don't exist.

- [ ] **Step 3: Implement `sendSweepItemMessage` and `maybeSendEveningSweep`**

`sendSweepItemMessage`: same shape as `sendNagMessage` but the Done/Tomorrow/Drop button row and no "Overdue:" prefix (just the title and due time, if any). `maybeSendEveningSweep`: `EVENING_SWEEP_WINDOW_UTC = 13` hour check, same `syncState.eveningSweepSentAt` once-per-day guard pattern as Task 7. Query active, not-snoozed `type: "todo"` tasks where `dueAt <= now` (overdue) OR (`dueAt > now && dueAt < startOfTomorrowSgt(now)`) (due today) — no undated bucket here, per the design. Set `eveningSweepSentAt: now` right after the query, before the empty check. If empty, return `{ sent: false }`. Otherwise `sendMessage(getOwnerChatId(), "Still open:")`, then `sendSweepItemMessage(getOwnerChatId(), task)` for each candidate; return `{ sent: true }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/telegram/todo-messages.test.ts tests/reminders/check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/todo-messages.ts lib/reminders/check.ts tests/telegram/todo-messages.test.ts tests/reminders/check.test.ts
git commit -m "feat: add 9pm SGT evening sweep"
```

---

### Task 9: Wire the cron route and document the new env var

**Files:**
- Modify: `app/api/cron/check-reminders/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `checkOverdueTodoNags` (Task 5), `maybeSendMorningDigest` (Task 7), `maybeSendEveningSweep` (Task 8) from `lib/reminders/check.ts`.

- [ ] **Step 1: Wire the three new checks into the cron route**

In `app/api/cron/check-reminders/route.ts`, after the existing four `await` calls, add `const nags = await checkOverdueTodoNags(now);`, `const morningDigest = await maybeSendMorningDigest(now);`, `const eveningSweep = await maybeSendEveningSweep(now);`, and include `telegramNagsSent: nags.notified`, `morningDigestSent: morningDigest.sent`, `eveningSweepSent: eveningSweep.sent` in the returned JSON — same sequential-await style as the four existing checks (no new try/catch layering; matches the existing route's own convention).

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: full suite green (472+ existing tests plus every test added in Tasks 1–8).

Run: `npm run build`
Expected: a clean production build (confirms no type errors across the new files).

- [ ] **Step 3: Document the new env var**

In `.env.example`, add a line under the existing `TELEGRAM_ALLOWED_CHAT_IDS` entry:
```
# Callum's own numeric Telegram chat id — the only chat that receives
# overdue-to-do nags, the 9am digest, and the 9pm sweep. Separate from
# TELEGRAM_ALLOWED_CHAT_IDS above, which also includes an employee's chat.
TELEGRAM_OWNER_CHAT_ID=
```

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/check-reminders/route.ts .env.example
git commit -m "feat: wire telegram nag/digest/sweep checks into the reminder cron"
```
