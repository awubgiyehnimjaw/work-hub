# Team Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `/team` section to the existing work-hub app — four tabs (Tasks, Reviews, Posting Schedule, Content Ideas) in a black-and-white, stat-card/filter/table layout, for Callum and his employees to browse.

**Architecture:** One new pure classification function and one new API route for the posting schedule's full (not just due-soon) list; everything else reuses existing API routes as-is. The page itself is new frontend-only work: a tab-switching shell plus four small per-tab components sharing two presentational primitives (a stat card, a status dot).

**Tech Stack:** Next.js App Router, React, existing `fetch`-based client components (no new libraries).

**Spec:** `docs/superpowers/specs/2026-11-23-team-dashboard-design.md`

## Global Constraints

- Lives inside the existing `work-hub` app, same deployment — no new auth code; `middleware.ts` already protects every route by default.
- `GET /api/tasks` and `GET /api/content-ideas/all` are reused exactly as they are today — no backend changes to either.
- Exactly one new backend piece: a posting-schedule classification function plus `GET /api/posting-schedule/all`, built on the existing `fetchPostingScheduleCsv`/`parsePostingScheduleCsv`.
- Read-only. No task in this plan adds a mutation action (no PATCH/POST/DELETE) anywhere on the `/team` surface.
- Invoices and Suggestions are out of scope — no task touches them.
- Visual language fixed by the approved mockup (`.superpowers/brainstorm/82593-1795405804/content/team-dashboard.html`): black-and-white, `.td-wrap`/`.td-top`/`.td-stats`/`.td-controls`/`.td-table` structure, status shown as a filled/outline/ghost dot — never color.

## Review Focus

This codebase has no component-level test runner (no `@testing-library`, no `.tsx` test files) — every existing page/component in this project is verified by hand in the browser, not by an automated render test. The items below are pinned as explicit browser-verification checks in the task that owns them, not as `vitest` tests, since there is no harness here to write one against.

- **A posting-schedule entry with a blank/unparseable Post Date** — the existing due-soon filter silently drops these; the new full-list endpoint must not (it's meant to show *everything*). Covered by an automated test in Task 1 (the classifier has a real test runner).
- **An entry completed via the app's Done button but whose sheet Notes doesn't say "done"** (or vice versa) — must still classify as `"done"`, matching what the existing Done button already shows. Covered by an automated test in Task 1.
- **A to-do with `dueAt: null`** on the Tasks tab — `classifyDueStatus` requires a non-null `Date`, so the tab must branch before calling it rather than crash or miscount. Pinned as an explicit browser-verification check in Task 4 (seed a due-date-less to-do, confirm it renders in the "no due date" bucket, not an error).
- **Search text and a status/client pill filter active at the same time** — all active filters must compose (AND), matching the reference tool's own behavior. Pinned as an explicit browser-verification check in Task 3 (the richest tab, sets the pattern the other tabs reuse).
- **Zero results after filtering** (a status/client combination with nothing in it) — must show an empty state, not a blank table with just headers. Pinned as a browser-verification check in Task 3.

---

### Task 1: Full posting-schedule status classification

**Files:**
- Modify: `lib/posting-schedule/sheet.ts`
- Test: `tests/posting-schedule/sheet.test.ts`

**Interfaces:**
- Produces:
  - `export type FullPostingScheduleStatus = "overdue" | "due-soon" | "upcoming" | "done" | "on-hold";`
  - `export function classifyFullPostingScheduleStatus(entry: Pick<PostingScheduleEntry, "postDate" | "notes">, todayKey: string, isCompleted: boolean): FullPostingScheduleStatus`

- [ ] **Step 1: Write the failing tests**

```typescript
test("classifyFullPostingScheduleStatus returns 'done' when isCompleted is true, regardless of date or notes", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-01-01", notes: null }, "2026-06-01", true)).toBe("done");
});

test("classifyFullPostingScheduleStatus returns 'done' when the sheet's own Notes says 'done', even if not completed in the app", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-01-01", notes: "done" }, "2026-06-01", false)).toBe("done");
});

test("classifyFullPostingScheduleStatus returns 'on-hold' when Notes says 'hold' and it isn't completed", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-01-01", notes: "hold" }, "2026-06-01", false)).toBe("on-hold");
});

test("classifyFullPostingScheduleStatus prefers 'done' over 'hold' when both signals are present", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-01-01", notes: "hold" }, "2026-06-01", true)).toBe("done");
});

test("classifyFullPostingScheduleStatus returns 'upcoming' for a blank Post Date (not completed, no hold)", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: null, notes: null }, "2026-06-01", false)).toBe("upcoming");
});

test("classifyFullPostingScheduleStatus returns 'overdue' for a past-or-today date, not completed, no hold", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-06-01", notes: null }, "2026-06-01", false)).toBe("overdue");
});

test("classifyFullPostingScheduleStatus returns 'due-soon' for a date within 3 days", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-06-03", notes: null }, "2026-06-01", false)).toBe("due-soon");
});

test("classifyFullPostingScheduleStatus returns 'upcoming' for a date more than 3 days out", () => {
  expect(classifyFullPostingScheduleStatus({ postDate: "2026-06-10", notes: null }, "2026-06-01", false)).toBe("upcoming");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/posting-schedule/sheet.test.ts`
Expected: FAIL — `classifyFullPostingScheduleStatus` not defined.

- [ ] **Step 3: Implement `classifyFullPostingScheduleStatus` in `lib/posting-schedule/sheet.ts`**

Priority order: `isCompleted` or `notes?.toLowerCase() === "done"` → `"done"`; else `notes?.toLowerCase() === "hold"` → `"on-hold"`; else no `postDate` → `"upcoming"`; else reuse this file's existing private `dateKeyToUtcMs`/`DAY_MS` to compute the day difference against `todayKey`, same arithmetic as `classifyPostingScheduleStatus` — `<= 0` → `"overdue"`, `<= 3` → `"due-soon"`, else `"upcoming"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/posting-schedule/sheet.test.ts`
Expected: PASS, all 8 new tests plus every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add lib/posting-schedule/sheet.ts tests/posting-schedule/sheet.test.ts
git commit -m "feat: add full-list status classification for posting-schedule entries"
```

---

### Task 2: `GET /api/posting-schedule/all`

**Files:**
- Create: `app/api/posting-schedule/all/route.ts`
- Test: `tests/api/posting-schedule-all.test.ts`

**Interfaces:**
- Consumes: `classifyFullPostingScheduleStatus`, `FullPostingScheduleStatus`, `entryKey`, `fetchPostingScheduleCsv`, `parsePostingScheduleCsv`, `sgtDateKey` (all from `lib/posting-schedule/sheet.ts`, Task 1 and pre-existing); `postingScheduleCompletions` (`lib/db/schema.ts`).
- Produces: `GET` returning `({ entryKey: string; client: string; video: string; postDate: string | null; notes: string | null; status: FullPostingScheduleStatus })[]`, sorted by `postDate` ascending (entries with no date last) — every entry in the sheet, nothing filtered out.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/api/posting-schedule-all.test.ts — same vi.mock("@/lib/posting-schedule/sheet", ...) pattern as tests/api/posting-schedule.test.ts
test("GET /api/posting-schedule/all returns every entry, including ones far in the future and already done", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    "That Place,Far Future Video,,31 Dec 2026,,",
    "LoveLots,Already Done Video,,01 Jan 2020,done,",
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveLength(2);
  const done = body.find((e: { video: string }) => e.video === "Already Done Video");
  expect(done.status).toBe("done");
});

test("GET /api/posting-schedule/all reports a completions-table row as 'done' even though the sheet's own Notes is blank", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    "That Place,Completed Elsewhere,,01 Jan 2020,,",
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);
  const key = entryKey({ client: "That Place", video: "Completed Elsewhere", postDate: "2020-01-01" });
  await db.insert(postingScheduleCompletions).values({ entryKey: key });

  const res = await GET();
  const body = await res.json();
  expect(body[0].status).toBe("done");
  expect(body[0].entryKey).toBe(key);
});

test("GET /api/posting-schedule/all returns 500 when the sheet fetch fails", async () => {
  fetchPostingScheduleCsvMock.mockRejectedValue(new Error("network error"));
  const res = await GET();
  expect(res.status).toBe(500);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/api/posting-schedule-all.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `app/api/posting-schedule/all/route.ts`**

Fetch + parse the CSV (catch and 500 on failure, matching `app/api/posting-schedule/due-soon/route.ts`'s own error handling); load `postingScheduleCompletions` into a `Set<string>` of keys; map every parsed entry to `{ ...entry, entryKey: entryKey(entry), status: classifyFullPostingScheduleStatus(entry, sgtDateKey(new Date()), completedKeys.has(entryKey(entry))) }`; sort by `(a.postDate ?? "").localeCompare(b.postDate ?? "")` so no-date entries sort last (empty string sorts before any real date string — reverse the comparison, or map missing dates to a sentinel that sorts last, e.g. `"9999-99-99"`, before comparing).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/api/posting-schedule-all.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, 0 failures (aside from any pre-existing unrelated flakiness — if you see failures, re-run the specific failing file alone before treating it as a real regression).

- [ ] **Step 6: Commit**

```bash
git add app/api/posting-schedule/all/route.ts tests/api/posting-schedule-all.test.ts
git commit -m "feat: add GET /api/posting-schedule/all"
```

---

### Task 3: Team page shell + Posting Schedule tab

**Files:**
- Create: `app/team/page.tsx`
- Create: `app/components/team/TeamStatCard.tsx`
- Create: `app/components/team/TeamDot.tsx`
- Create: `app/components/team/PostingScheduleTab.tsx`
- Modify: `app/page.tsx` (nav link)

**Interfaces:**
- Consumes: `GET /api/posting-schedule/all` (Task 2's response shape).
- Produces (used by Tasks 4-6):
  - `TeamStatCard(props: { label: string; value: number; sub?: string; active?: boolean }): JSX.Element`
  - `TeamDot(props: { variant: "filled" | "outline" | "ghost" | "none" }): JSX.Element`
  - The page's own tab-switching state and layout — Tasks 4-6 each add one more case to the same switch and one more entry to the same tab-button row; no new exported interface beyond the two components above.

- [ ] **Step 1: Build `TeamStatCard` and `TeamDot`**

Plain presentational components, black-and-white, matching the mockup's `.td-stat`/`.td-stat.active` and `.td-dot`/`.td-dot.outline`/`.td-dot.ghost` (no dot rendered at all for `variant: "none"`) — port the mockup's CSS as inline `style={{...}}` objects, the convention every existing page/component in this codebase already uses (e.g. `app/page.tsx`, `app/invoices/page.tsx`) — no CSS modules, no new styling approach.

- [ ] **Step 2: Build `PostingScheduleTab`**

`PostingScheduleTab(props: { entries: Array<{ entryKey: string; client: string; video: string; postDate: string | null; notes: string | null; status: "overdue" | "due-soon" | "upcoming" | "done" | "on-hold" }> }): JSX.Element`. Renders, from the mockup's structure: a stat-card row (Total, Due soon, Overdue, Done, On hold — counts computed by filtering `props.entries` by `status`), a search input (filters by `client`/`video`/`notes` substring, case-insensitive), status filter pills (All status + one per `FullPostingScheduleStatus` value, each showing its count), client filter pills (All clients + one per distinct `client` in `props.entries`, each showing its count), and the table itself (Client/Video/Edit By — *left out of the API response; show "—" for every row, this field doesn't exist in the current data model*/Post Date/Status (via `TeamDot` + label)/Notes). All three filters (search text, status pill, client pill) apply together (AND). An empty-after-filtering state shows a plain "No matching entries" row instead of a bare header.

- [ ] **Step 3: Build `app/team/page.tsx`**

Client component. On mount, `fetch("/api/posting-schedule/all")` and store the result; a tab-button row (Tasks / Reviews / Posting Schedule / Content Ideas) with local `useState` for the active tab, defaulting to `"tasks"`; for now, only the `"posting-schedule"` case renders (`<PostingScheduleTab entries={...} />`), the other three render a plain "Coming soon" placeholder (replaced in Tasks 4-6). Page-level header/nav matching the mockup's `.td-top` (title "Team Dashboard", subtitle "Shared view — same login as the app").

- [ ] **Step 4: Add the nav link**

In `app/page.tsx`, add `<a href="/team" className="interactive" style={{ fontSize: 14, color: "var(--color-text-muted)", textDecoration: "none" }}>Team →</a>` alongside the existing Clients/Ideas/Suggestions/History/Invoices links.

- [ ] **Step 5: Verify in the browser**

Start the dev server, open `/team`. Confirm: the Posting Schedule tab renders real data from the actual CSV (or seeded local data) with correct stat-card counts; typing in search narrows the table; selecting a status pill AND a client pill together narrows further (the Review Focus AND-composition check); a filter combination with nothing in it shows the empty state, not a bare table; clicking "Team →" from `/` reaches this page and back works.

- [ ] **Step 6: Commit**

```bash
git add app/team/page.tsx app/components/team/TeamStatCard.tsx app/components/team/TeamDot.tsx app/components/team/PostingScheduleTab.tsx app/page.tsx
git commit -m "feat: add the /team dashboard shell and its Posting Schedule tab"
```

---

### Task 4: Tasks tab

**Files:**
- Create: `app/components/team/TasksTab.tsx`
- Modify: `app/team/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tasks` (existing; this task fetches and filters to `type === "todo"` itself); `classifyDueStatus` (`lib/tasks/due-status.ts`); `TeamStatCard`, `TeamDot` (Task 3).
- Produces: `TasksTab(props: { todos: Array<{ id: string; title: string; dueAt: string | null }> }): JSX.Element`

- [ ] **Step 1: Build `TasksTab`**

Same structural language as `PostingScheduleTab`: stat cards (Total active, Overdue, Due soon [red-or-yellow from `classifyDueStatus`], No due date soon [green-or-null]) computed by mapping each todo's `dueAt` (parsed to `Date`, skipping `classifyDueStatus` entirely when `dueAt` is `null`) to a dot variant — `null` result or `"green"` → `"none"`, `"red"`/`"yellow"` → `"outline"`, `"overdue"` → `"filled"`; a search box (title substring); a status filter (All / Overdue / Due soon / No due date soon); a table (Title, Due date, Status dot+label). No client filter — to-dos have no client.

- [ ] **Step 2: Wire it into `app/team/page.tsx`**

Fetch `/api/tasks` alongside the existing posting-schedule fetch; filter to `type === "todo"`; replace the `"tasks"` tab's placeholder with `<TasksTab todos={...} />`.

- [ ] **Step 3: Verify in the browser**

Confirm the Tasks tab shows real to-dos with correct stat-card counts, including at least one to-do with no due date (the Review Focus check) rendering in the "No due date soon" bucket without error.

- [ ] **Step 4: Commit**

```bash
git add app/components/team/TasksTab.tsx app/team/page.tsx
git commit -m "feat: add the /team dashboard's Tasks tab"
```

---

### Task 5: Reviews tab

**Files:**
- Create: `app/components/team/ReviewsTab.tsx`
- Modify: `app/team/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tasks` (already fetched by Task 4's page-level change; this task filters the same already-fetched array to `type === "review"` rather than fetching again); `TeamStatCard`, `TeamDot` (Task 3).
- Produces: `ReviewsTab(props: { reviews: Array<{ id: string; title: string; clientName: string | null; isStale: boolean }> }): JSX.Element`

- [ ] **Step 1: Build `ReviewsTab`**

Stat cards: Total active, Stale, Not stale — computed directly from each review's existing `isStale` boolean (no reclassification needed, `GET /api/tasks` already computes it server-side). Search box (title/client substring). Status filter (All / Stale / Not stale). Client filter pills (All clients + one per distinct non-null `clientName`). Table (Client, Title, Status dot+label) — `isStale: true` → `"filled"`, else `"none"`.

- [ ] **Step 2: Wire it into `app/team/page.tsx`**

Filter the already-fetched `/api/tasks` result to `type === "review"`; replace the `"reviews"` tab's placeholder with `<ReviewsTab reviews={...} />`.

- [ ] **Step 3: Verify in the browser**

Confirm the Reviews tab shows real review tasks, correct stale/not-stale counts, and that client filter pills match the clients actually present.

- [ ] **Step 4: Commit**

```bash
git add app/components/team/ReviewsTab.tsx app/team/page.tsx
git commit -m "feat: add the /team dashboard's Reviews tab"
```

---

### Task 6: Content Ideas tab

**Files:**
- Create: `app/components/team/ContentIdeasTab.tsx`
- Modify: `app/team/page.tsx`

**Interfaces:**
- Consumes: `GET /api/content-ideas/all` (existing, unmodified); `TeamStatCard` (Task 3).
- Produces: `ContentIdeasTab(props: { ideas: Array<{ id: string; text: string; clientName: string | null }> }): JSX.Element`

- [ ] **Step 1: Build `ContentIdeasTab`**

Stat cards: Total, one per distinct client (count + name) — no status dimension here (content ideas have no workflow state), so no `TeamDot` usage in this tab. Search box (text/client substring). Client filter pills (All clients + one per distinct non-null `clientName`). Table (Client, Idea text, Logged — this tab has no `createdAt` in its stated prop shape above; if you want a date column, add `createdAt: string` to the prop type and fetch it through, since `GET /api/content-ideas/all` already returns it).

- [ ] **Step 2: Wire it into `app/team/page.tsx`**

Fetch `/api/content-ideas/all` alongside the page's other fetches; replace the `"content-ideas"` tab's placeholder with `<ContentIdeasTab ideas={...} />`.

- [ ] **Step 3: Verify in the browser**

Confirm the Content Ideas tab shows real ideas grouped/filterable by client, with correct counts.

- [ ] **Step 4: Run the full suite one more time**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add app/components/team/ContentIdeasTab.tsx app/team/page.tsx
git commit -m "feat: add the /team dashboard's Content Ideas tab"
```
