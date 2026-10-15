# Telegram Capture Bot + Content Ideas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Callum message a Telegram bot (voice or text) to add a to-do or a client content idea, with the bot replying with a one-line confirmation, and give content ideas their own page in Work Hub grouped by client.

**Architecture:** A webhook route (`POST /api/telegram/webhook`) receives every Telegram message, verifies it's from Callum, transcribes voice via OpenAI if needed, sends the resulting text to OpenAI for structured extraction (type/client/text/dueAt), then writes to the existing `tasks` table (to-dos, via a new shared helper) or a new `content_ideas` table, and replies in-chat. A new `/content-ideas` page lists ideas grouped by client with manual add/edit/delete, mirroring the existing `/clients` and `/suggestions` pages exactly.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (Postgres), Vitest. No new npm dependencies — Telegram and OpenAI are both called with plain `fetch`, matching `lib/frameio/client.ts`'s existing pattern (this codebase has no API SDKs at all, only hand-rolled REST clients).

**Spec:** [docs/superpowers/specs/2026-10-16-telegram-bot-content-ideas-design.md](../specs/2026-10-16-telegram-bot-content-ideas-design.md)

## Global Constraints

- Only the Telegram chat ID in `TELEGRAM_ALLOWED_CHAT_ID` may create anything; any other chat is fully ignored (no DB write, no reply).
- Every message from the allowed chat gets a reply — success confirmation, a "couldn't match that client" notice, or an "unclear" prompt to resend. Never silent for an authorized sender.
- A content idea has no status/priority/due date — just `clientId`, `text`, `createdAt`.
- A bot-added to-do may carry a `dueAt` resolved from relative phrasing ("tomorrow", "Friday") against the message's received time; absent any date mention, `dueAt` is `null`.
- Inserting a content idea never writes to `clients.lastActivityAt`.
- One new third-party vendor (OpenAI) for both transcription and parsing — one new env var, `OPENAI_API_KEY`.
- No new npm dependencies for Telegram or OpenAI — plain `fetch`, following `lib/frameio/client.ts`.

## Review Focus

- Deleting a client that has content ideas (even with zero tasks) must return a clean 409, not crash — `content_ideas` adds a second foreign key the existing delete-conflict check in `app/api/clients/[id]/route.ts` doesn't yet recognize.
- A Telegram webhook retry (the same `update_id` delivered twice, which Telegram does on a slow or non-200 response) must not create a duplicate to-do/content idea or send a duplicate reply.
- A message from any chat ID other than `TELEGRAM_ALLOWED_CHAT_ID` must be fully ignored — no DB write, no reply, nothing that confirms the bot exists.
- A client name the model returns that doesn't match any recognized client's display name must not create a new client or silently file the idea under the wrong one — it must produce a clear "couldn't match" reply instead.
- A failure partway through handling a message (transcription, parsing, or sending the reply) must never crash the request or leave a to-do/idea half-saved — the webhook always responds 200, and a reply failure must not block or be blocked by the underlying database write.

---

### Task 1: Schema — `content_ideas` and `telegram_updates` tables

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/db/migrations/0005_add_content_ideas_and_telegram_updates.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `contentIdeas` table — `id: uuid` (pk, default random), `clientId: uuid` (not null, references `clients.id`), `text: text` (not null), `createdAt: timestamp` (not null, default now). Inferred row type `typeof contentIdeas.$inferSelect`.
- Produces: `telegramUpdates` table — `updateId: integer` (primary key — Telegram's own `update_id`, used for de-dup, no surrogate id needed), `processedAt: timestamp` (not null, default now).

- [ ] **Step 1: Add both tables to `lib/db/schema.ts`**, importing `integer` from `drizzle-orm/pg-core` alongside the existing imports. Place `contentIdeas` near `tasks`/`clients`; place `telegramUpdates` near `syncState`.

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `lib/db/migrations/0005_*.sql` file containing `CREATE TABLE "content_ideas" ...` and `CREATE TABLE "telegram_updates" ...`, plus an updated `lib/db/migrations/meta/_journal.json` and a new `lib/db/migrations/meta/0005_snapshot.json`. Rename the generated file to `0005_add_content_ideas_and_telegram_updates.sql` if drizzle-kit picks a different auto-generated name, and update the `tag` in `_journal.json` to match.

- [ ] **Step 3: Run the full test suite to confirm the new tables don't break anything**

Run: `npx vitest run`
Expected: PASS (same count as before plus zero new — this task adds no tests of its own; later tasks exercise these tables through real inserts).

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts lib/db/migrations/
git commit -m "feat: add content_ideas and telegram_updates tables"
```

---

### Task 2: Shared `createTodo` helper

**Files:**
- Create: `lib/tasks/create-todo.ts`
- Modify: `app/api/tasks/route.ts` (replace the inline insert in `POST` with a call to `createTodo`)
- Test: `tests/tasks/create-todo.test.ts`

**Interfaces:**
- Consumes: `tasks` table from `@/lib/db/schema`, `db` from `@/lib/db/client`.
- Produces: `createTodo(input: { title: string; dueAt: Date | null }): Promise<typeof tasks.$inferSelect>` — inserts `{ type: "todo", title, status: "active", dueAt }` and returns the created row. Used by Task 7's webhook route.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tasks/create-todo.test.ts
test("creates an active todo task with the given title and due date", async () => {
  const task = await createTodo({ title: "Call the client", dueAt: new Date("2026-02-01T00:00:00Z") });
  expect(task.type).toBe("todo");
  expect(task.status).toBe("active");
  expect(task.title).toBe("Call the client");
  expect(task.dueAt).toEqual(new Date("2026-02-01T00:00:00Z"));
});

test("creates a todo with a null due date when none is given", async () => {
  const task = await createTodo({ title: "Loose idea", dueAt: null });
  expect(task.dueAt).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tasks/create-todo.test.ts`
Expected: FAIL — `createTodo` is not defined.

- [ ] **Step 3: Implement `createTodo` in `lib/tasks/create-todo.ts`**, then refactor `app/api/tasks/route.ts`'s `POST` handler to call it instead of its own `db.insert(tasks)...` block. Keep `parseQuickAddPayload` and the 400 response exactly as they are — only the insert itself moves.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tasks/create-todo.test.ts tests/api/tasks.test.ts`
Expected: PASS — the new tests pass, and every existing `tests/api/tasks.test.ts` test still passes unchanged (this refactor must not change `POST /api/tasks`'s observable behavior).

- [ ] **Step 5: Commit**

```bash
git add lib/tasks/create-todo.ts app/api/tasks/route.ts tests/tasks/create-todo.test.ts
git commit -m "refactor: extract createTodo helper for reuse by the Telegram webhook"
```

---

### Task 3: Shared timing-safe compare + Telegram webhook secret check

**Files:**
- Create: `lib/auth/timing-safe-equal.ts`
- Modify: `lib/auth/cron-secret.ts` (remove its private `timingSafeEqual`, import the shared one)
- Create: `lib/telegram/webhook-auth.ts`
- Test: `tests/auth/timing-safe-equal.test.ts`
- Test: `tests/telegram/webhook-auth.test.ts`

**Interfaces:**
- Produces: `timingSafeEqual(a: string, b: string): boolean` in `lib/auth/timing-safe-equal.ts` — identical behavior to the function currently private to `lib/auth/cron-secret.ts`.
- Produces: `checkTelegramWebhookSecret(req: Request): boolean` in `lib/telegram/webhook-auth.ts` — reads `process.env.TELEGRAM_WEBHOOK_SECRET`, fails closed (`false`) if unset, compares it against the `x-telegram-bot-api-secret-token` request header via `timingSafeEqual`. Used by Task 7's webhook route.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/auth/timing-safe-equal.test.ts
test("true for equal strings", () => { expect(timingSafeEqual("abc", "abc")).toBe(true); });
test("false for different strings of the same length", () => { expect(timingSafeEqual("abc", "abd")).toBe(false); });
test("false for different lengths", () => { expect(timingSafeEqual("abc", "ab")).toBe(false); });
```

```ts
// tests/telegram/webhook-auth.test.ts
beforeEach(() => { process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret"; });

function requestWith(headerValue?: string): Request {
  const headers: HeadersInit = {};
  if (headerValue !== undefined) headers["x-telegram-bot-api-secret-token"] = headerValue;
  return new Request("http://localhost/api/telegram/webhook", { headers });
}

test("accepts the correct secret header", () => {
  expect(checkTelegramWebhookSecret(requestWith("test-webhook-secret"))).toBe(true);
});
test("rejects a missing header", () => {
  expect(checkTelegramWebhookSecret(requestWith())).toBe(false);
});
test("rejects the wrong secret", () => {
  expect(checkTelegramWebhookSecret(requestWith("wrong"))).toBe(false);
});
test("fails closed when TELEGRAM_WEBHOOK_SECRET is not set", () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  expect(checkTelegramWebhookSecret(requestWith("test-webhook-secret"))).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auth/timing-safe-equal.test.ts tests/telegram/webhook-auth.test.ts`
Expected: FAIL — neither module exists yet.

- [ ] **Step 3: Implement `timingSafeEqual` in `lib/auth/timing-safe-equal.ts`** (move the existing loop-based implementation out of `lib/auth/cron-secret.ts` verbatim), **update `lib/auth/cron-secret.ts`** to import and use it instead of its own copy, and **implement `checkTelegramWebhookSecret` in `lib/telegram/webhook-auth.ts`** following `checkCronSecret`'s fail-closed structure (env check, header check, `timingSafeEqual` compare).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/auth/timing-safe-equal.test.ts tests/telegram/webhook-auth.test.ts tests/auth/cron-secret.test.ts`
Expected: PASS — including every existing `cron-secret.test.ts` test unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/timing-safe-equal.ts lib/auth/cron-secret.ts lib/telegram/webhook-auth.ts tests/auth/timing-safe-equal.test.ts tests/telegram/webhook-auth.test.ts
git commit -m "refactor: share timing-safe compare between cron and Telegram webhook auth"
```

---

### Task 4: Telegram Bot API client

**Files:**
- Create: `lib/telegram/client.ts`
- Test: `tests/telegram/client.test.ts`

**Interfaces:**
- Consumes: `process.env.TELEGRAM_BOT_TOKEN`.
- Produces:
  - `sendMessage(chatId: number, text: string): Promise<void>` — `POST https://api.telegram.org/bot<token>/sendMessage` with `{ chat_id, text }`; throws on a non-2xx response.
  - `getFilePath(fileId: string): Promise<string>` — `GET https://api.telegram.org/bot<token>/getFile?file_id=<fileId>`, returns `body.result.file_path`; throws on a non-2xx response or a missing `file_path`.
  - `downloadFile(filePath: string): Promise<ArrayBuffer>` — `GET https://api.telegram.org/file/bot<token>/<filePath>`, returns the response body as an `ArrayBuffer`; throws on a non-2xx response.
  - All three throw `Error("TELEGRAM_BOT_TOKEN environment variable is not set")` if the env var is missing, mirroring `lib/frameio/client.ts`'s `requireEnv`.
  - Used by Task 7's webhook route.

- [ ] **Step 1: Write the failing tests** — mock `global.fetch` with `vi.stubGlobal`, following `tests/frameio/client.test.ts`'s pattern (`afterEach(() => vi.unstubAllGlobals())`).

```ts
beforeAll(() => { process.env.TELEGRAM_BOT_TOKEN = "test-bot-token"; });

test("sendMessage posts chat_id and text to the sendMessage endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await sendMessage(123, "hello");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/bottest-bot-token/sendMessage");
  expect(JSON.parse(init.body)).toEqual({ chat_id: 123, text: "hello" });
});

test("sendMessage throws on a non-2xx response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
  await expect(sendMessage(123, "hello")).rejects.toThrow();
});

test("getFilePath returns result.file_path from a successful response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ result: { file_path: "voice/file_1.oga" } }), { status: 200 }),
  ));
  expect(await getFilePath("file-id-1")).toBe("voice/file_1.oga");
});

test("downloadFile returns the response body as an ArrayBuffer", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { status: 200 })));
  const buffer = await downloadFile("voice/file_1.oga");
  expect(new Uint8Array(buffer)).toEqual(bytes);
});

test("throws when TELEGRAM_BOT_TOKEN is not set", async () => {
  const original = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  await expect(sendMessage(123, "hi")).rejects.toThrow("TELEGRAM_BOT_TOKEN");
  process.env.TELEGRAM_BOT_TOKEN = original;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/telegram/client.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `lib/telegram/client.ts`** with the three functions above, a local `requireEnv("TELEGRAM_BOT_TOKEN")` matching `lib/frameio/client.ts`'s shape, and `const TELEGRAM_API_BASE = "https://api.telegram.org"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/telegram/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/telegram/client.ts tests/telegram/client.test.ts
git commit -m "feat: add Telegram Bot API client"
```

---

### Task 5: OpenAI client — transcription + message parsing

**Files:**
- Create: `lib/openai/client.ts`
- Test: `tests/openai/client.test.ts`

**Interfaces:**
- Consumes: `process.env.OPENAI_API_KEY`.
- Produces:
  - `transcribeVoice(audio: ArrayBuffer, filename: string): Promise<string>` — `POST https://api.openai.com/v1/audio/transcriptions` as `multipart/form-data` (the audio blob + a current, cost-appropriate OpenAI transcription model — exact model string is the implementer's call, verify it's still current/available at build time), returns the transcript text. Throws on a non-2xx response.
  - `parseCaptureMessage(text: string, now: Date, clientNames: string[]): Promise<ParsedCapture>` where `ParsedCapture = { type: "todo" | "content_idea" | "unclear"; client: string | null; text: string; dueAt: string | null }` (`dueAt` is an ISO timestamp or `null`) — `POST https://api.openai.com/v1/chat/completions` (or `/v1/responses`) with a system prompt instructing structured JSON output, given `clientNames` as the only valid values for `client` and `now` as the reference time for resolving relative dates. **Never throws**: on a non-2xx response, a network failure, or a response whose content isn't valid JSON matching the `ParsedCapture` shape, logs the error and returns `{ type: "unclear", client: null, text, dueAt: null }` — the caller (Task 7) must be able to trust this always resolves to a usable value.
  - Both used by Task 7's webhook route.

- [ ] **Step 1: Write the failing tests**

```ts
beforeAll(() => { process.env.OPENAI_API_KEY = "test-openai-key"; });

test("transcribeVoice posts the audio and returns the transcript text", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ text: "call the client tomorrow" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await transcribeVoice(new ArrayBuffer(8), "voice.oga");
  expect(result).toBe("call the client tomorrow");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/audio/transcriptions");
});

test("transcribeVoice throws on a non-2xx response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 500 })));
  await expect(transcribeVoice(new ArrayBuffer(8), "voice.oga")).rejects.toThrow();
});

test("parseCaptureMessage returns the parsed structure for a well-formed model response", async () => {
  const modelOutput = { type: "content_idea", client: "ARC", text: "before and after reel", dueAt: null };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }), { status: 200 }),
  ));
  const result = await parseCaptureMessage("content idea for ARC, before and after reel", new Date(), ["ARC", "LoveLots"]);
  expect(result).toEqual(modelOutput);
});

test("parseCaptureMessage sends the given client names and current text in the request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ type: "unclear", client: null, text: "x", dueAt: null }) } }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  await parseCaptureMessage("hello", new Date(), ["ARC", "LoveLots"]);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(JSON.stringify(body)).toContain("ARC");
  expect(JSON.stringify(body)).toContain("LoveLots");
});

test("parseCaptureMessage falls back to unclear on a non-2xx response instead of throwing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 500 })));
  const result = await parseCaptureMessage("hello", new Date(), ["ARC"]);
  expect(result).toEqual({ type: "unclear", client: null, text: "hello", dueAt: null });
});

test("parseCaptureMessage falls back to unclear when the model's content isn't valid JSON", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }),
  ));
  const result = await parseCaptureMessage("hello", new Date(), ["ARC"]);
  expect(result.type).toBe("unclear");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/openai/client.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `lib/openai/client.ts`** with both functions, a local `requireEnv("OPENAI_API_KEY")`, and the fallback-to-`unclear` try/catch wrapping all of `parseCaptureMessage`'s body. The system prompt text and exact model names are the implementer's call (per the spec) — write something that instructs the model to classify type, extract the client only from the given `clientNames` list, extract the idea/to-do text, and resolve any relative date against `now`, returning only the JSON object shape above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/openai/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/openai/client.ts tests/openai/client.test.ts
git commit -m "feat: add OpenAI client for voice transcription and message parsing"
```

---

### Task 6: Content Ideas CRUD API routes

**Files:**
- Create: `app/api/content-ideas/all/route.ts`
- Create: `app/api/content-ideas/[id]/route.ts`
- Modify: `app/api/clients/[id]/route.ts` (generalize the delete-conflict check to also cover `content_ideas`)
- Test: `tests/api/content-ideas-manage.test.ts`
- Test: modify `tests/api/clients-manage.test.ts` (one new test)

**Interfaces:**
- Produces: `GET /api/content-ideas/all` → every content idea joined with `clients.displayName` as `clientName`, ordered by client display name then `createdAt` descending within each client.
- Produces: `POST /api/content-ideas/all` with `{ clientId: string, text: string }` → 201 with the created row, 400 if `clientId` isn't a valid UUID or doesn't reference an existing client, or `text` is empty.
- Produces: `PATCH /api/content-ideas/[id]` with any subset of `{ clientId?: string, text?: string }` → 200 with the updated row, 400 if the body is empty or a provided `clientId`/`text` is invalid, 404 if not found.
- Produces: `DELETE /api/content-ideas/[id]` → 200, 404 if not found.
- Modifies: `DELETE /api/clients/[id]` — `isForeignKeyViolation` is now checked against both `"tasks_client_id_clients_id_fk"` and `"content_ideas_client_id_clients_id_fk"`, returning the same 409 for either.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/api/content-ideas-manage.test.ts — mirror tests/api/clients-manage.test.ts's structure exactly:
// beforeEach deletes contentIdeas then clients; helper functions postRequest/patchRequest/context;
// a NONEXISTENT_ID constant.

test("GET /api/content-ideas/all returns ideas joined with client name, grouped order", async () => { /* insert two clients, two ideas; assert order and clientName */ });
test("POST /api/content-ideas/all creates an idea and returns 201", async () => { /* ... */ });
test("POST /api/content-ideas/all returns 400 for an invalid clientId", async () => { /* clientId: "not-a-uuid" */ });
test("POST /api/content-ideas/all returns 400 when clientId doesn't reference an existing client", async () => { /* a well-formed but nonexistent UUID */ });
test("POST /api/content-ideas/all returns 400 for empty text", async () => { /* ... */ });
test("PATCH /api/content-ideas/:id updates text and clientId independently", async () => { /* ... */ });
test("PATCH /api/content-ideas/:id returns 404 for a nonexistent id", async () => { /* ... */ });
test("PATCH /api/content-ideas/:id returns 400 for an empty body", async () => { /* ... */ });
test("DELETE /api/content-ideas/:id removes the row", async () => { /* ... */ });
test("DELETE /api/content-ideas/:id returns 404 for a nonexistent id", async () => { /* ... */ });
```

```ts
// append to tests/api/clients-manage.test.ts
test("DELETE /api/clients/:id returns 409 instead of crashing when the client still has content ideas", async () => {
  const [row] = await db.insert(clients).values({ tag: "idea-haver", displayName: "Idea Co", recognized: true, lastActivityAt: null }).returning();
  await db.insert(contentIdeas).values({ clientId: row.id, text: "an idea" });

  const res = await DELETE(new Request("http://localhost"), context(row.id));
  expect(res.status).toBe(409);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/content-ideas-manage.test.ts tests/api/clients-manage.test.ts`
Expected: FAIL — routes don't exist yet, and the new clients-manage test fails with a 500 (unhandled FK violation) rather than 409.

- [ ] **Step 3: Implement `app/api/content-ideas/all/route.ts` and `app/api/content-ideas/[id]/route.ts`**, mirroring `app/api/clients/all/route.ts` and `app/api/clients/[id]/route.ts`'s structure (payload parsing functions, `isForeignKeyViolation`/UUID validation inline — a local UUID regex constant like the one already in `app/api/tasks/route.ts`, no new shared module needed for one regex). `POST`/`PATCH` validate `clientId` by `SELECT`ing the client first and returning 400 if it's missing, rather than relying on the database's own FK error. **Update `app/api/clients/[id]/route.ts`'s `DELETE`** to check `isForeignKeyViolation(error, "tasks_client_id_clients_id_fk") || isForeignKeyViolation(error, "content_ideas_client_id_clients_id_fk")` — before wiring this up, confirm the actual generated name in Task 1's `0005_*.sql` (`ALTER TABLE "content_ideas" ADD CONSTRAINT "..." FOREIGN KEY ...`) matches; drizzle-kit's naming convention (`<table>_<column>_<ref_table>_<ref_column>_fk`) predicts this exact string, but the migration file is the source of truth.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/content-ideas-manage.test.ts tests/api/clients-manage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/content-ideas/ app/api/clients/[id]/route.ts tests/api/content-ideas-manage.test.ts tests/api/clients-manage.test.ts
git commit -m "feat: add content ideas CRUD routes, cover their FK in client deletion"
```

---

### Task 7: Telegram webhook route

**Files:**
- Create: `app/api/telegram/webhook/route.ts`
- Modify: `middleware.ts` (add `/api/telegram` to `PUBLIC_PATH_PREFIXES` — it has its own secret-header auth, same reasoning as `/api/cron`)
- Test: `tests/api/telegram-webhook.test.ts`
- Test: modify `tests/middleware.test.ts` (add `/api/telegram/webhook` to the allowlisted-paths `test.each`)

**Interfaces:**
- Consumes: `checkTelegramWebhookSecret` (Task 3), `sendMessage`/`getFilePath`/`downloadFile` (Task 4), `transcribeVoice`/`parseCaptureMessage` (Task 5), `createTodo` (Task 2), `contentIdeas`/`telegramUpdates`/`clients` tables (Task 1).
- Produces: `POST /api/telegram/webhook` — always responds `200` to any request that passes the secret check (Telegram retries on non-200), except `401` when the secret check itself fails.

- [ ] **Step 1: Write the failing tests** — `vi.mock("@/lib/telegram/client", ...)` and `vi.mock("@/lib/openai/client", ...)` entirely (mirroring `tests/reminders/check.test.ts`'s mock of `@/lib/push/send`), so no real network call happens and `sendMessage`'s call args can be asserted directly.

```ts
process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
process.env.TELEGRAM_ALLOWED_CHAT_ID = "999";
const ALLOWED_CHAT_ID = 999;

function updateRequest(body: unknown, secret = "test-webhook-secret"): Request {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}

test("returns 401 when the secret header is wrong", async () => {
  const res = await POST(updateRequest({ update_id: 1 }, "wrong"));
  expect(res.status).toBe(401);
});

test("a text message classified as todo creates a task and replies with a confirmation", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "call the client", dueAt: null });
  const res = await POST(updateRequest({ update_id: 1, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, call the client" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("call the client");
  expect(mockSendMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, expect.stringContaining("call the client"));
});

test("a text message classified as content_idea with a matching client creates an idea and replies", async () => {
  const [client] = await db.insert(clients).values({ tag: "arc", displayName: "ARC", recognized: true, lastActivityAt: null }).returning();
  mockParseCaptureMessage.mockResolvedValue({ type: "content_idea", client: "ARC", text: "before and after reel", dueAt: null });
  const res = await POST(updateRequest({ update_id: 2, message: { chat: { id: ALLOWED_CHAT_ID }, text: "content idea for ARC, before and after reel" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(1);
  expect(rows[0].clientId).toBe(client.id);
  expect(mockSendMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, expect.stringContaining("ARC"));
});

test("a content_idea with a client name that matches nothing replies with a couldn't-match message and writes nothing", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "content_idea", client: "Nonexistent Co", text: "idea", dueAt: null });
  const res = await POST(updateRequest({ update_id: 3, message: { chat: { id: ALLOWED_CHAT_ID }, text: "content idea for Nonexistent Co, idea" } }));
  expect(res.status).toBe(200);
  expect(await db.select().from(contentIdeas)).toHaveLength(0);
  expect(mockSendMessage).toHaveBeenCalled();
});

test("an unclear message writes nothing and asks Callum to resend", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "unclear", client: null, text: "hmm", dueAt: null });
  const res = await POST(updateRequest({ update_id: 4, message: { chat: { id: ALLOWED_CHAT_ID }, text: "hmm" } }));
  expect(res.status).toBe(200);
  expect(await db.select().from(tasks)).toHaveLength(0);
  expect(await db.select().from(contentIdeas)).toHaveLength(0);
  expect(mockSendMessage).toHaveBeenCalled();
});

test("a message from a chat other than the allowed one is fully ignored — no DB write, no reply", async () => {
  const res = await POST(updateRequest({ update_id: 5, message: { chat: { id: 111 }, text: "to do, anything" } }));
  expect(res.status).toBe(200);
  expect(await db.select().from(tasks)).toHaveLength(0);
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test("the same update_id delivered twice is only processed once", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "once only", dueAt: null });
  const update = { update_id: 6, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, once only" } };
  await POST(updateRequest(update));
  await POST(updateRequest(update));
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
});

test("a voice message is transcribed before being parsed", async () => {
  mockGetFilePath.mockResolvedValue("voice/f1.oga");
  mockDownloadFile.mockResolvedValue(new ArrayBuffer(8));
  mockTranscribeVoice.mockResolvedValue("to do, pick up the drive");
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "pick up the drive", dueAt: null });
  const res = await POST(updateRequest({ update_id: 7, message: { chat: { id: ALLOWED_CHAT_ID }, voice: { file_id: "file-1" } } }));
  expect(res.status).toBe(200);
  expect(mockTranscribeVoice).toHaveBeenCalled();
  expect(mockParseCaptureMessage).toHaveBeenCalledWith("to do, pick up the drive", expect.any(Date), expect.any(Array));
});

test("a reply-send failure doesn't prevent the underlying write or crash the request", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "still saved", dueAt: null });
  mockSendMessage.mockRejectedValueOnce(new Error("Telegram is down"));
  const res = await POST(updateRequest({ update_id: 8, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, still saved" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/api/telegram-webhook.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `app/api/telegram/webhook/route.ts`**:
  1. `checkTelegramWebhookSecret` → 401 if false.
  2. Parse the body; if there's no `message`, return 200 immediately (nothing to do).
  3. Insert `{ updateId: update.update_id }` into `telegramUpdates` with `.onConflictDoNothing().returning()`; if nothing came back, it's a duplicate — return 200 immediately without reprocessing.
  4. If `message.chat.id` (as a string) doesn't equal `process.env.TELEGRAM_ALLOWED_CHAT_ID`, return 200 with no reply.
  5. Resolve message text: `message.voice` → `getFilePath` → `downloadFile` → `transcribeVoice`; else `message.text`; else reply "text or voice only" and return 200. Wrap this whole step in try/catch — on failure, best-effort `sendMessage` an error notice (itself wrapped so a failed reply can't throw) and return 200.
  6. `SELECT` clients `WHERE recognized = true`, pass their `displayName`s to `parseCaptureMessage(text, new Date(), names)`.
  7. Branch on `parsed.type`: `"todo"` → `createTodo({ title: parsed.text, dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null })`, then reply; `"content_idea"` → case-insensitively match `parsed.client` against the recognized list, insert into `contentIdeas` and reply on a match, reply "couldn't match" on no match (nothing written); `"unclear"` → reply asking Callum to resend with "to do" or "content idea for \<client\>".
  8. Every `sendMessage` call is wrapped so a rejection is logged, not thrown — the route always ends by returning `NextResponse.json({ status: "ok" }, { status: 200 })` once past the secret/duplicate/chat-id checks.

  Then **add `"/api/telegram"` to `middleware.ts`'s `PUBLIC_PATH_PREFIXES`** array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/api/telegram-webhook.test.ts tests/middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, same total as before plus this task's new tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/telegram/webhook/route.ts middleware.ts tests/api/telegram-webhook.test.ts tests/middleware.test.ts
git commit -m "feat: add Telegram webhook — capture to-dos and content ideas by voice or text"
```

---

### Task 8: Content Ideas page + dashboard nav link

**Files:**
- Create: `app/content-ideas/page.tsx`
- Modify: `app/page.tsx` (add an "Ideas →" nav link alongside Clients/Suggestions/History)

**Interfaces:**
- Consumes: `GET/POST /api/content-ideas/all`, `PATCH/DELETE /api/content-ideas/[id]` (Task 6), `GET /api/clients/all` (existing — for the add-form's client picker, filtered client-side to `recognized`).

- [ ] **Step 1: Implement `app/content-ideas/page.tsx`**, copying `app/clients/page.tsx`'s structure: load state, grouped list (group by `clientName`, sorted by client name, newest idea first within each group — mirror `app/history/page.tsx`'s `groupByClient` shape for the grouping logic, adapted to content ideas), an add form (client `<select>` populated from recognized clients + text input), inline edit (text + client reassignment) and two-step delete-confirm per idea — same `.interactive` className, CSS variable tokens, and card styling already established (`var(--color-surface)`, `var(--shadow-card)`, etc.) as every other page in `app/`.

- [ ] **Step 2: Add the nav link** in `app/page.tsx`'s header `<div>` (the one already containing the Clients/Suggestions/History links), as `<a href="/content-ideas" className="interactive" ...>Ideas →</a>`, same style as its siblings.

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both succeed with no errors.

- [ ] **Step 4: Verify in the browser** — start the dev server, log in, add a client's worth of content ideas through the UI, confirm grouping/edit/delete render and work (same manual verification already done for the Clients page this session — no automated UI tests exist in this codebase).

- [ ] **Step 5: Commit**

```bash
git add app/content-ideas/page.tsx app/page.tsx
git commit -m "feat: add Content Ideas page and dashboard nav link"
```

---

### Task 9: Env docs and Telegram bot setup instructions

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/deploy-notes.md`

- [ ] **Step 1: Add the four new env vars to `.env.example`** — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_ID`, `OPENAI_API_KEY` — each with the same one-line-comment style as the existing entries (what it's for, where it comes from).

- [ ] **Step 2: Add a new section to `docs/superpowers/deploy-notes.md`** (after the existing integrations, before "Verify end to end"), covering: creating the bot via @BotFather and getting the token; finding Callum's own numeric chat ID (e.g. messaging the bot once, then checking `getUpdates`, or a helper bot like @userinfobot); generating `TELEGRAM_WEBHOOK_SECRET` the same way as `CRON_SECRET` (`openssl rand -hex 32`); setting all four env vars in Vercel; registering the webhook with one `curl` call to `https://api.telegram.org/bot<token>/setWebhook` passing `url` (the deployed `/api/telegram/webhook` URL) and `secret_token`; and a note to rename "Ulti" to "Ultimate Intern" via the already-shipped `/clients` page as part of this same setup pass, since the content-ideas client roster assumes that display name.

- [ ] **Step 3: Commit**

```bash
git add .env.example docs/superpowers/deploy-notes.md
git commit -m "docs: document Telegram bot + OpenAI setup"
```
