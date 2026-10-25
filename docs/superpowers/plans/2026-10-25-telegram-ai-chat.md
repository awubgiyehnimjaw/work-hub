# Telegram AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Telegram capture bot a second mode — real AI chat, grounded in the app's own data, that the existing classifier falls through to automatically.

**Architecture:** Two-stage, additive. The existing `parseCaptureMessage` classifier and its `todo`/`content_idea` branches in `app/api/telegram/webhook/route.ts` stay untouched. Its `unclear` outcome (plus a short-circuit for an in-progress disambiguation) now calls a new chat handler instead of sending a fixed reply. The chat handler runs a Groq tool-calling agent loop against a small set of read/write tools that each wrap existing app logic, backed by a new short-term conversation-memory table that both the chat handler and the existing capture flow write to.

**Tech Stack:** Next.js API route (existing), Drizzle/Neon (existing), Groq chat-completions with OpenAI-compatible tool calling (new usage of the existing `lib/groq/client.ts` integration).

**Spec:** `docs/superpowers/specs/2026-10-25-telegram-ai-chat-design.md`

## Global Constraints

- Must use the existing Groq integration (`lib/groq/client.ts`) — no new paid API.
- Must reuse the existing `isAllowedChatId` gate — no new auth surface.
- No change to the existing to-do/content-idea capture flow's own behavior (classification, creation, confirmation wording) — only additive logging alongside it.
- No new write actions beyond "mark done" on to-dos, reviews, and posting-schedule entries. No delete/edit/snooze through chat.
- No long-term memory — only the last ~10 messages per chat, no pruning job.
- Single-user scale — no concurrency/volume optimization needed.

## Review Focus

- **A Groq response with no `tool_calls` and no `content`** (seen in some OpenAI-compatible providers on certain finish reasons) — the agent loop must still end in *some* safe reply to Callum rather than crashing or sending `undefined`. Covered in Task 5.
- **A tool call with a malformed/unknown function name or unparseable JSON arguments** from the model — the loop must feed back a tool-result error the model can recover from, not throw and lose the whole exchange. Covered in Task 5.
- **The round cap is hit** (model keeps calling tools without ever settling on a plain-text reply) — Callum must still get a reply, not silence. Covered in Task 5.
- **A write tool's DB call fails after the model already decided to call it** (e.g. the id it saw in a read tool's result was deleted a moment later) — must not crash the webhook, and must not send a false "done" confirmation. Covered in Task 4.
- **Two messages arrive close together** (e.g. Callum answers his own disambiguation question quickly) — the ~10-minute clarifying-question routing check must key off the correct chat id and not leak across chats or misfire once the window has passed. Covered in Task 1 and Task 7.

---

## Task 1: Conversation memory table

**Files:**
- Modify: `lib/db/schema.ts` (add `conversationMessages` table)
- Create: `lib/db/migrations/0011_add_conversation_messages.sql` (generated)
- Create: `lib/telegram/conversation-memory.ts`
- Test: `tests/telegram/conversation-memory.test.ts`

**Interfaces:**
- Produces:
  - `appendMessage(chatId: number, role: "user" | "assistant", content: string, at: Date): Promise<void>`
  - `getRecentMessages(chatId: number, limit: number): Promise<{ role: "user" | "assistant"; content: string; createdAt: Date }[]>` — ascending (oldest first), at most `limit` rows, scoped to `chatId`.
  - `shouldSkipClassifier(chatId: number, now: Date): Promise<boolean>` — `true` only when the single most recent row for `chatId` has `role === "assistant"`, its `content.trim()` ends with `"?"`, and `now.getTime() - createdAt.getTime() <= 10 * 60 * 1000`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/telegram/conversation-memory.test.ts
test("getRecentMessages returns rows for that chat in chronological order", async () => {
  await appendMessage(1, "user", "first", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(1, "assistant", "second", new Date("2026-01-01T00:00:01Z"));
  await appendMessage(2, "user", "other chat", new Date("2026-01-01T00:00:02Z"));
  const rows = await getRecentMessages(1, 10);
  expect(rows.map((r) => r.content)).toEqual(["first", "second"]);
});

test("getRecentMessages returns at most the last `limit` rows", async () => {
  for (let i = 0; i < 12; i++) {
    await appendMessage(1, "user", `msg ${i}`, new Date(2026, 0, 1, 0, 0, i));
  }
  const rows = await getRecentMessages(1, 10);
  expect(rows).toHaveLength(10);
  expect(rows[rows.length - 1].content).toBe("msg 11");
});

test("shouldSkipClassifier is true when the last message is the bot asking a question within 10 minutes", async () => {
  const now = new Date("2026-01-01T00:10:00Z");
  await appendMessage(1, "user", "the dentist thing", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(1, "assistant", "Did you mean the dentist to-do or the vet one?", new Date("2026-01-01T00:05:00Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(true);
});

test("shouldSkipClassifier is false once more than 10 minutes have passed", async () => {
  const now = new Date("2026-01-01T00:20:00Z");
  await appendMessage(1, "assistant", "Which one did you mean?", new Date("2026-01-01T00:05:00Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(false);
});

test("shouldSkipClassifier is false when the last message is the bot's plain answer, not a question", async () => {
  const now = new Date("2026-01-01T00:01:00Z");
  await appendMessage(1, "assistant", "You have 3 to-dos due this week.", new Date("2026-01-01T00:00:00Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(false);
});

test("shouldSkipClassifier is false when the last message in that chat is from the user", async () => {
  const now = new Date("2026-01-01T00:01:00Z");
  await appendMessage(1, "assistant", "Which one?", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(1, "user", "the dentist one", new Date("2026-01-01T00:00:30Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/telegram/conversation-memory.test.ts`
Expected: FAIL — `appendMessage`/`getRecentMessages`/`shouldSkipClassifier` not defined (module doesn't exist yet).

- [ ] **Step 3: Add the `conversationMessages` table to `lib/db/schema.ts`**

```typescript
export const conversationRoleEnum = pgEnum("conversation_role", ["user", "assistant"]);

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: text("chat_id").notNull(),
  role: conversationRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

`chatId` is `text` (stored as `String(chatId)`), matching how `isAllowedChatId` already compares chat ids as strings — avoids any risk of a Telegram chat id exceeding Postgres `integer` range.

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: creates `lib/db/migrations/0011_add_conversation_messages.sql` and updates `lib/db/migrations/meta/_journal.json` + a new snapshot — same shape as `0008_add_posting_schedule_completions.sql`.

- [ ] **Step 5: Implement `lib/telegram/conversation-memory.ts`**

`appendMessage` inserts one row (`chatId: String(chatId)`). `getRecentMessages` selects the last `limit` rows for that chat ordered by `createdAt` descending, then reverses to chronological order before returning (don't rely on `createdAt` alone being unique under fast successive inserts in a test — order by `createdAt` then `id` as a tiebreaker, or simply trust insertion order within a single test by spacing timestamps as the tests above do). `shouldSkipClassifier` calls `getRecentMessages(chatId, 1)` and checks the three conditions in its Produces signature above.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/telegram/conversation-memory.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/0011_add_conversation_messages.sql lib/db/migrations/meta lib/telegram/conversation-memory.ts tests/telegram/conversation-memory.test.ts
git commit -m "feat: add conversation-memory table for the Telegram chat handler"
```

---

## Task 2: Capture flow also writes to conversation memory

**Files:**
- Modify: `app/api/telegram/webhook/route.ts`
- Modify: `tests/api/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `appendMessage` from Task 1 (`lib/telegram/conversation-memory.ts`).

**Why:** so a follow-up like "actually make that due Friday" — which will later route to the chat handler, not the classifier — has the to-do that was just created in its short-term memory.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/telegram-webhook.test.ts
test("a successful to-do capture logs both the user message and the confirmation to conversation memory", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "call the client", dueAt: null });
  await POST(updateRequest({ update_id: 900, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, call the client" } }));
  const rows = await db.select().from(conversationMessages).orderBy(asc(conversationMessages.createdAt));
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ role: "user", content: "to do, call the client" });
  expect(rows[1]).toMatchObject({ role: "assistant" });
  expect(rows[1].content).toContain("call the client");
});
```

Add `conversationMessages` to the existing `import { clients, contentIdeas, tasks, telegramUpdates } from "@/lib/db/schema"` line and to the `beforeEach`'s cleanup (`await db.delete(conversationMessages)`), and add `asc` to the existing `drizzle-orm` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/api/telegram-webhook.test.ts`
Expected: FAIL — `rows` has length 0 (nothing written to `conversationMessages` yet).

- [ ] **Step 3: Log both sides of the exchange in the two success branches**

In `app/api/telegram/webhook/route.ts`'s `try` block (around the existing `parsed.type === "todo"` and `parsed.type === "content_idea"` branches), after each branch's `replySafely(chatId, ...)` call, add:

```typescript
await appendMessage(chatId, "user", text, new Date());
await appendMessage(chatId, "assistant", <the exact string just passed to replySafely>, new Date());
```

Import `appendMessage` from `@/lib/telegram/conversation-memory`. Scope this to only the two branches that create something (`todo` and the matched-client half of `content_idea`) — the no-match-client reply and the (soon to be removed, Task 7) `unclear` branch are not part of this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/api/telegram-webhook.test.ts`
Expected: PASS, including the new test and all pre-existing ones.

- [ ] **Step 5: Commit**

```bash
git add app/api/telegram/webhook/route.ts tests/api/telegram-webhook.test.ts
git commit -m "feat: log successful to-do/content-idea captures to conversation memory"
```

---

## Task 3: Extract shared "mark done" functions

**Files:**
- Create: `lib/tasks/complete.ts`
- Create: `lib/posting-schedule/complete.ts`
- Modify: `app/api/tasks/[id]/route.ts`
- Modify: `app/api/posting-schedule/complete/route.ts`
- Test: `tests/tasks/complete.test.ts`
- Test: `tests/posting-schedule/complete.test.ts`

**Interfaces:**
- Produces:
  - `completeTask(id: string, now: Date): Promise<typeof tasks.$inferSelect | null>` — sets `status: "completed"`, `completedAt: now`; if the updated row is `type: "review"` with a non-null `clientId`, also bumps that client's `lastActivityAt` to `now`. Returns `null` if no task with that id exists.
  - `completePostingScheduleEntry(entryKey: string): Promise<void>` — the existing insert-with-`onConflictDoNothing`, unchanged behavior.

**Why:** Task 4's chat tools must reuse the exact logic the app's own "mark done" UI buttons call (per the design's anti-goal against duplicated logic drifting out of sync), not re-derive it.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tasks/complete.test.ts
test("completeTask sets status and completedAt", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "t", status: "active" }).returning();
  const result = await completeTask(task.id, new Date("2026-01-01T00:00:00Z"));
  expect(result?.status).toBe("completed");
  expect(result?.completedAt).toEqual(new Date("2026-01-01T00:00:00Z"));
});

test("completeTask on a review task with a client bumps that client's lastActivityAt", async () => {
  const [client] = await db.insert(clients).values({ tag: "x", displayName: "X", recognized: true, lastActivityAt: null }).returning();
  const [task] = await db.insert(tasks).values({ type: "review", title: "r", status: "active", clientId: client.id }).returning();
  await completeTask(task.id, new Date("2026-01-01T00:00:00Z"));
  const [updatedClient] = await db.select().from(clients).where(eq(clients.id, client.id));
  expect(updatedClient.lastActivityAt).toEqual(new Date("2026-01-01T00:00:00Z"));
});

test("completeTask returns null for an unknown id", async () => {
  expect(await completeTask(randomUUID(), new Date())).toBeNull();
});
```

```typescript
// tests/posting-schedule/complete.test.ts
test("completePostingScheduleEntry inserts the entry key", async () => {
  await completePostingScheduleEntry("Client|Video|2026-01-01");
  const rows = await db.select().from(postingScheduleCompletions);
  expect(rows).toHaveLength(1);
  expect(rows[0].entryKey).toBe("Client|Video|2026-01-01");
});

test("completePostingScheduleEntry is idempotent", async () => {
  await completePostingScheduleEntry("k");
  await completePostingScheduleEntry("k");
  expect(await db.select().from(postingScheduleCompletions)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/tasks/complete.test.ts tests/posting-schedule/complete.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Implement `lib/tasks/complete.ts` and `lib/posting-schedule/complete.ts`**

Move the exact update/bump logic currently inline in `app/api/tasks/[id]/route.ts`'s `PATCH` handler (the `action === "complete"` case plus the review/client bump that follows it) into `completeTask`. Move the exact insert from `app/api/posting-schedule/complete/route.ts`'s `POST` handler into `completePostingScheduleEntry`.

- [ ] **Step 4: Run new tests to verify they pass**

Run: `npm test -- tests/tasks/complete.test.ts tests/posting-schedule/complete.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor both routes to call the extracted functions**

`app/api/tasks/[id]/route.ts`: when `parsed.action === "complete"`, call `completeTask(id, now)` and use its result in place of the current `db.update(...).returning()` + follow-up client-bump block; `404` when it returns `null`. Leave `reopen`/`snooze` untouched. `app/api/posting-schedule/complete/route.ts`: replace the insert with `completePostingScheduleEntry(entryKey)`.

- [ ] **Step 6: Run the full existing test suites for both routes to verify nothing broke**

Run: `npm test -- tests/api/tasks.test.ts tests/api/posting-schedule-complete.test.ts`
Expected: PASS — every pre-existing test, including the `lastActivityAt` regression coverage, unchanged.

- [ ] **Step 7: Commit**

```bash
git add lib/tasks/complete.ts lib/posting-schedule/complete.ts app/api/tasks/[id]/route.ts app/api/posting-schedule/complete/route.ts tests/tasks/complete.test.ts tests/posting-schedule/complete.test.ts
git commit -m "refactor: extract completeTask/completePostingScheduleEntry for reuse by the chat tools"
```

---

## Task 4: Chat tool functions (read + write)

**Files:**
- Create: `lib/telegram/chat-tools.ts`
- Test: `tests/telegram/chat-tools.test.ts`

**Interfaces:**
- Consumes: `completeTask` and `completePostingScheduleEntry` from Task 3; `classifyPostingScheduleStatus`, `entryKey`, `fetchPostingScheduleCsv`, `filterByNotCompleted`, `filterDueSoon`, `parsePostingScheduleCsv`, `sgtDateKey` from `lib/posting-schedule/sheet.ts`; `isTaskStale` from `lib/tasks/aging.ts`.
- Produces (every read function's returned objects include `id`; this is what later tool-call arguments reference):
  - `listActiveTodos(now: Date): Promise<{ id: string; title: string; dueAt: string | null }[]>` — `tasks` where `type = "todo"`, `status = "active"`, not currently snoozed (same filter as `GET /api/tasks`'s default). `dueAt` as an ISO string or `null`.
  - `listActiveReviews(now: Date): Promise<{ id: string; title: string; clientName: string | null }[]>` — `tasks` where `type = "review"`, `status = "active"`, not currently snoozed, left-joined to `clients` for `displayName`.
  - `listDueSoonPostingScheduleEntries(now: Date): Promise<{ entryKey: string; client: string; video: string; postDate: string | null; status: "none" | "green" | "red" }[]>` — fetch + parse the sheet, `filterDueSoon`, drop completed via `filterByNotCompleted` against `postingScheduleCompletions`, tag with `entryKey`/`status` — the same pipeline as `GET /api/posting-schedule/due-soon`.
  - `listUpcomingCalendarEvents(now: Date): Promise<{ id: string; title: string; startAt: string; endAt: string }[]>` — `calendarEventsCache` where `endAt >= now` and `startAt <= now + 14 days`, same bound as `GET /api/calendar`.
  - `listContentIdeas(clientId: string | null): Promise<{ id: string; clientName: string | null; text: string }[]>` — all content ideas, optionally filtered to one `clientId`.
  - `markTodoDone(id: string, now: Date): Promise<boolean>` — calls `completeTask`; `true` if a row was updated and its `type` was `"todo"`, else `false` (including: id not found, or id belongs to a review — a wrong-type id is treated as "not found" here, not silently completed).
  - `markReviewDone(id: string, now: Date): Promise<boolean>` — same shape, requiring `type === "review"`.
  - `markPostingScheduleEntryDone(entryKey: string): Promise<void>` — calls `completePostingScheduleEntry` directly (no existence check possible — the sheet itself is the source of truth, not a DB row).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/telegram/chat-tools.test.ts
test("listActiveTodos returns only active todos with id/title/dueAt, excluding reviews and completed/snoozed", async () => {
  const now = new Date("2026-01-10T00:00:00Z");
  await db.insert(tasks).values([
    { type: "todo", title: "a", status: "active", dueAt: new Date("2026-01-12T00:00:00Z") },
    { type: "todo", title: "b", status: "completed" },
    { type: "todo", title: "c", status: "active", snoozedUntil: new Date("2026-02-01T00:00:00Z") },
    { type: "review", title: "d", status: "active" },
  ]);
  const result = await listActiveTodos(now);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ title: "a", dueAt: "2026-01-12T00:00:00.000Z" });
});

test("markTodoDone completes a todo and returns true", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "a", status: "active" }).returning();
  expect(await markTodoDone(task.id, new Date())).toBe(true);
  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(updated.status).toBe("completed");
});

test("markTodoDone returns false for a review task's id", async () => {
  const [task] = await db.insert(tasks).values({ type: "review", title: "r", status: "active" }).returning();
  expect(await markTodoDone(task.id, new Date())).toBe(false);
  const [unchanged] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(unchanged.status).toBe("active");
});

test("markTodoDone returns false for an unknown id", async () => {
  expect(await markTodoDone(randomUUID(), new Date())).toBe(false);
});

test("markReviewDone completes a review and returns true, and false for a todo's id", async () => {
  const [review] = await db.insert(tasks).values({ type: "review", title: "r", status: "active" }).returning();
  expect(await markReviewDone(review.id, new Date())).toBe(true);
  const [todo] = await db.insert(tasks).values({ type: "todo", title: "t", status: "active" }).returning();
  expect(await markReviewDone(todo.id, new Date())).toBe(false);
});

test("listContentIdeas filters by clientId when given", async () => {
  const [a] = await db.insert(clients).values({ tag: "a", displayName: "A", recognized: true }).returning();
  const [b] = await db.insert(clients).values({ tag: "b", displayName: "B", recognized: true }).returning();
  await db.insert(contentIdeas).values([{ clientId: a.id, text: "idea a" }, { clientId: b.id, text: "idea b" }]);
  const result = await listContentIdeas(a.id);
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("idea a");
});
```

(`markPostingScheduleEntryDone`/`listDueSoonPostingScheduleEntries` mock `fetchPostingScheduleCsv` the same way `tests/posting-schedule` already does for the sheet-reading functions — follow that file's existing mocking pattern; `listUpcomingCalendarEvents`/`listActiveReviews` follow the same insert-then-query shape as the tests above.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/telegram/chat-tools.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `lib/telegram/chat-tools.ts`**

Each function is a thin, independently-readable query — the active/snooze filter for todos and reviews mirrors `app/api/tasks/route.ts`'s existing `statusFilter` logic (re-expressed here, not imported, since that route's version is coupled to its own `clientRecognized`/`isStale` annotations which the chat tools don't need).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/telegram/chat-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/chat-tools.ts tests/telegram/chat-tools.test.ts
git commit -m "feat: add read/write tool functions for the Telegram chat agent"
```

---

## Task 5: Groq tool-calling agent loop

**Files:**
- Modify: `lib/groq/client.ts`
- Test: `tests/groq/client.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (pure Groq HTTP mechanics).
- Produces:
  ```typescript
  export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>; // JSON Schema
  }
  export interface ToolCallRequest { id: string; name: string; arguments: string }
  export type ToolDispatcher = (call: ToolCallRequest) => Promise<string>; // returns the tool result as a string (JSON-stringify objects)

  export async function runToolCallingAgent(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    userText: string,
    tools: ToolDefinition[],
    dispatch: ToolDispatcher,
  ): Promise<string> // the final plain-text reply
  ```

**Before writing any test for this task:** run a live smoke test against the real Groq API to confirm the exact tool-calling response shape for `openai/gpt-oss-120b`, the same way `PARSE_MODEL`'s own comment in this file was confirmed against a real `GET /v1/models` response rather than trusted from docs. `GROQ_API_KEY` is not present in this project's `.env.local` (only in the deployed Vercel environment) — ask Callum for the key's value before running this, rather than fetching it from Vercel. Run, from the repo root:

```bash
GROQ_API_KEY="<value Callum provides>" npx tsx -e '
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: "What is 2 plus 2? Use the add tool." }],
    tools: [{ type: "function", function: { name: "add", description: "Adds two numbers", parameters: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } } }],
  }),
});
console.log(JSON.stringify(await res.json(), null, 2));
'
```

Confirm the response's `choices[0].message.tool_calls` array shape (`id`, `type: "function"`, `function.name`, `function.arguments` as a JSON string) matches the OpenAI-compatible shape assumed below — this is the standard shape every other OpenAI-compatible provider uses, so a mismatch here means a different parsing step is needed before continuing. Record the confirmed shape as a one-line comment above the new code (matching this file's existing `PARSE_MODEL` comment style), then proceed with TDD using that confirmed shape in the mocked tests below.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/groq/client.test.ts — mock fetch per test the same way parseCaptureMessage's tests already do
test("runToolCallingAgent returns the plain-text reply when the model calls no tools", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "You have 3 to-dos." } }] }), { status: 200 }),
  ));
  const result = await runToolCallingAgent("system", [], "what are my to-dos", [], async () => "");
  expect(result).toBe("You have 3 to-dos.");
});

test("runToolCallingAgent executes a tool call, sends the result back, and returns the model's follow-up reply", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_todos", arguments: "{}" } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "You have 1 to-do: call the client." } }],
    }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const dispatch = vi.fn().mockResolvedValue(JSON.stringify([{ id: "1", title: "call the client" }]));
  const result = await runToolCallingAgent("system", [], "what are my to-dos", [{ name: "list_todos", description: "d", parameters: {} }], dispatch);
  expect(dispatch).toHaveBeenCalledWith({ id: "call_1", name: "list_todos", arguments: "{}" });
  expect(result).toBe("You have 1 to-do: call the client.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("runToolCallingAgent returns a safe fallback reply when the model's response has neither tool_calls nor content", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null } }], finish_reason: "length" }), { status: 200 }),
  ));
  const result = await runToolCallingAgent("system", [], "hello", [], async () => "");
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

test("runToolCallingAgent stops after a capped number of rounds and returns a safe fallback reply", async () => {
  const alwaysCallsTool = new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: "list_todos", arguments: "{}" } }] } }],
  }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(alwaysCallsTool));
  const result = await runToolCallingAgent("system", [], "loop forever", [{ name: "list_todos", description: "d", parameters: {} }], async () => "[]");
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

test("runToolCallingAgent feeds back an error string when a tool call's arguments aren't valid JSON-parseable by the dispatcher, instead of throwing", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "mark_todo_done", arguments: "not json" } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Sorry, something went wrong." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const dispatch = vi.fn().mockRejectedValue(new SyntaxError("bad json"));
  const result = await runToolCallingAgent("system", [], "mark it done", [{ name: "mark_todo_done", description: "d", parameters: {} }], dispatch);
  expect(result).toBe("Sorry, something went wrong.");
  // the second request's body must include a tool-role message reporting the failure, not a thrown exception
  const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(JSON.stringify(secondBody)).toContain("call_1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/groq/client.test.ts`
Expected: FAIL — `runToolCallingAgent` not defined.

- [ ] **Step 3: Implement `runToolCallingAgent` in `lib/groq/client.ts`**

Build the OpenAI-compatible `messages` array (`system`, then `history` entries, then the new `user` message), convert `tools` to the `{ type: "function", function: { name, description, parameters } }` wire shape, and loop (cap at 5 rounds): POST to `/v1/chat/completions` with `tools`; if the response message has `tool_calls`, append that assistant message plus one `{ role: "tool", tool_call_id, content }` message per call (via `dispatch`, catching a dispatcher rejection into an error-describing `content` string rather than throwing) to `messages`, and loop; otherwise return `message.content` — falling back to a fixed short string (e.g. `"Sorry, I couldn't come up with a reply to that."`) when `content` is null/empty, or when the round cap is hit without ever getting a plain-text reply.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/groq/client.test.ts`
Expected: PASS, including all pre-existing tests in this file.

- [ ] **Step 5: Commit**

```bash
git add lib/groq/client.ts tests/groq/client.test.ts
git commit -m "feat: add a Groq tool-calling agent loop"
```

---

## Task 6: Chat handler

**Files:**
- Create: `lib/telegram/chat-handler.ts`
- Test: `tests/telegram/chat-handler.test.ts`

**Interfaces:**
- Consumes: `runToolCallingAgent`, `ToolDefinition`, `ToolCallRequest` (Task 5); every function from `lib/telegram/chat-tools.ts` (Task 4); `appendMessage`, `getRecentMessages` (Task 1); `sendMessage` (`lib/telegram/client.ts`, existing).
- Produces: `handleChatMessage(chatId: number, text: string, now: Date): Promise<void>` — never throws (same contract as the webhook's existing try/catch around the capture flow); on any internal failure, sends a safe fallback reply instead.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/telegram/chat-handler.test.ts — mock "@/lib/telegram/client" (sendMessage) and stub global fetch for Groq, same patterns as tests/api/telegram-webhook.test.ts and tests/groq/client.test.ts
test("a plain question with no matching tool gets answered directly and logged both ways", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "The capital of France is Paris." } }],
  }), { status: 200 })));
  await handleChatMessage(CHAT_ID, "what's the capital of France?", new Date("2026-01-01T00:00:00Z"));
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "The capital of France is Paris.");
  const rows = await getRecentMessages(CHAT_ID, 10);
  expect(rows.map((r) => r.content)).toEqual(["what's the capital of France?", "The capital of France is Paris."]);
});

test("a data question triggers a read tool call and the final reply is sent", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_active_todos", arguments: "{}" } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "You have 1 to-do: call the client." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await db.insert(tasks).values({ type: "todo", title: "call the client", status: "active" });
  await handleChatMessage(CHAT_ID, "what are my to-dos?", new Date());
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "You have 1 to-do: call the client.");
});

test("a write tool call sends its own immediate confirmation before the loop's final reply", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "call the client", status: "active" }).returning();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "mark_todo_done", arguments: JSON.stringify({ id: task.id }) } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Anything else?" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "mark call the client as done", new Date());
  expect(mockSendMessage).toHaveBeenNthCalledWith(1, CHAT_ID, expect.stringContaining("Done"));
  expect(mockSendMessage).toHaveBeenNthCalledWith(2, CHAT_ID, "Anything else?");
  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(updated.status).toBe("completed");
});

test("a write tool call for an id that no longer exists sends no false confirmation, and the loop's own reply still goes out", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "mark_todo_done", arguments: JSON.stringify({ id: randomUUID() }) } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I couldn't find that one — can you check the title?" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "mark that as done", new Date());
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "I couldn't find that one — can you check the title?");
});

test("conversation history is passed to Groq as prior context", async () => {
  await appendMessage(CHAT_ID, "user", "add buy milk to todo", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(CHAT_ID, "assistant", "✅ To-do added: buy milk", new Date("2026-01-01T00:00:01Z"));
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Sure, due Friday." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "actually make that due Friday", new Date("2026-01-01T00:01:00Z"));
  const firstRequestBody = JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body));
  expect(firstRequestBody).toContain("buy milk");
});

test("never throws — an unexpected Groq failure still sends a safe reply", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  await expect(handleChatMessage(CHAT_ID, "hello", new Date())).resolves.toBeUndefined();
  expect(mockSendMessage).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/telegram/chat-handler.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `lib/telegram/chat-handler.ts`**

Build the 8 `ToolDefinition`s (JSON Schema `parameters` for each — `list_active_todos`/`list_active_reviews`/`list_due_soon_posting_schedule_entries`/`list_upcoming_calendar_events` take no required arguments; `list_content_ideas` takes an optional `clientId`; `mark_todo_done`/`mark_review_done` take a required `id`; `mark_posting_schedule_entry_done` takes a required `entryKey`). The system prompt states, verbatim in substance: Callum's local time now (reuse the `Asia/Singapore` formatting this file already has for `formatLocalDateTime`), that it must never state a fact about his to-dos/schedule/reviews/calendar/content unless it came from a tool call made in this exchange, that it must ask rather than guess when more than one item plausibly matches a "mark done" request, and that replies should be short (Telegram chat, not an essay).

The `dispatch` callback switches on `call.name`, `JSON.parse`s `call.arguments`, calls the matching `chat-tools.ts` function, and `JSON.stringify`s the result as the returned string. For the three write tools specifically, on a truthy/void success the dispatcher also calls `sendMessage(chatId, ...)` with an immediate confirmation (e.g. `"✅ Done: <title>"`/`"✅ Marked as done."`) *before* returning the tool result string back into the loop — independent of whatever the loop's eventual final reply turns out to be, per the design's requirement that the DB change and Callum's confirmation never come apart.

`handleChatMessage` itself: `getRecentMessages(chatId, 10)`, call `runToolCallingAgent`, `sendMessage(chatId, finalReply)`, then `appendMessage` for both the user's `text` and `finalReply`. The whole body is wrapped in try/catch; on any thrown error, `replySafely`-style fallback (log, then best-effort `sendMessage(chatId, "Something went wrong — try again.")`), matching the webhook's own `replySafely` pattern.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/telegram/chat-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/chat-handler.ts tests/telegram/chat-handler.test.ts
git commit -m "feat: add the Telegram chat handler (tool-grounded AI chat)"
```

---

## Task 7: Wire the webhook's routing

**Files:**
- Modify: `app/api/telegram/webhook/route.ts`
- Modify: `tests/api/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `shouldSkipClassifier` (Task 1), `handleChatMessage` (Task 6).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/telegram-webhook.test.ts — add `vi.mock("@/lib/telegram/chat-handler", () => ({ handleChatMessage: vi.fn().mockResolvedValue(undefined) }))`
// and import/mock it the same way parseCaptureMessage is mocked above.

test("an unclear message routes to the chat handler instead of the fixed reply", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "unclear", client: null, text: "hmm", dueAt: null });
  const res = await POST(updateRequest({ update_id: 10, message: { chat: { id: ALLOWED_CHAT_ID }, text: "hmm" } }));
  expect(res.status).toBe(200);
  expect(mockHandleChatMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, "hmm", expect.any(Date));
  expect(mockSendMessage).not.toHaveBeenCalled(); // the old fixed reply is gone; the (mocked) handler owns replying
});

test("a message arriving while the bot's last message was a recent clarifying question skips the classifier entirely", async () => {
  await appendMessage(ALLOWED_CHAT_ID, "assistant", "Did you mean the dentist to-do or the vet one?", new Date());
  const res = await POST(updateRequest({ update_id: 11, message: { chat: { id: ALLOWED_CHAT_ID }, text: "the dentist one" } }));
  expect(res.status).toBe(200);
  expect(mockParseCaptureMessage).not.toHaveBeenCalled();
  expect(mockHandleChatMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, "the dentist one", expect.any(Date));
});

test("a message arriving after the clarifying-question window has passed still goes through the classifier normally", async () => {
  await appendMessage(ALLOWED_CHAT_ID, "assistant", "Which one did you mean?", new Date(Date.now() - 11 * 60 * 1000));
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "new todo", dueAt: null });
  const res = await POST(updateRequest({ update_id: 12, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, new todo" } }));
  expect(res.status).toBe(200);
  expect(mockParseCaptureMessage).toHaveBeenCalled();
});
```

Remove the now-superseded existing test `"an unclear message writes nothing and asks Callum to resend"` (Task 7 changes exactly this behavior; replaced by the first test above).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/telegram-webhook.test.ts`
Expected: FAIL — classifier still runs unconditionally, and `unclear` still sends the fixed reply.

- [ ] **Step 3: Wire the routing**

In `app/api/telegram/webhook/route.ts`, after resolving `text` (voice/text) and before loading `recognizedClients`, check `await shouldSkipClassifier(chatId, new Date())`; if `true`, `await handleChatMessage(chatId, text, new Date())` and return `{ status: "ok" }` immediately — skip `parseCaptureMessage` and the recognized-clients lookup entirely. Otherwise proceed as today; change the final `else` branch (currently the fixed `"I couldn't tell if that's a to-do or a content idea..."` reply) to `await handleChatMessage(chatId, text, new Date())` instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/api/telegram-webhook.test.ts`
Expected: PASS, including all pre-existing tests (minus the one removed in Step 1).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add app/api/telegram/webhook/route.ts tests/api/telegram-webhook.test.ts
git commit -m "feat: route unclear/follow-up Telegram messages to the AI chat handler"
```

---

## Task 8: Deploy

**Files:** none (operational task)

- [ ] **Step 1: Run the full test suite one more time on the final branch state**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 2: Apply migration `0011` to production**

```bash
DATABASE_URL="<Neon connection string>" npx drizzle-kit migrate
```

Safe to run before deploying — purely additive (one new table), no existing code path touches it yet.

- [ ] **Step 3: Merge/push and deploy**

Follow `superpowers:finishing-a-development-branch` for the merge/push decision. No new environment variables are required (`GROQ_API_KEY`/`TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_CHAT_IDS`/`TELEGRAM_WEBHOOK_SECRET` already exist in the deployed environment from the original capture-bot feature).

- [ ] **Step 4: Verify live**

Send a real ambiguous/question message to the bot (e.g. "what to-dos do I have?") and confirm a grounded reply comes back; send a "mark X done" message for a real to-do and confirm both the immediate confirmation and the underlying row's `status` change.
