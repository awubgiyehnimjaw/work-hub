import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { calendarEventsCache, clients, contentIdeas, postingScheduleCompletions, tasks } from "@/lib/db/schema";

vi.mock("@/lib/posting-schedule/sheet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/posting-schedule/sheet")>("@/lib/posting-schedule/sheet");
  return { ...actual, fetchPostingScheduleCsv: vi.fn() };
});

import { entryKey, fetchPostingScheduleCsv } from "@/lib/posting-schedule/sheet";
import {
  listActiveReviews,
  listActiveTodos,
  listContentIdeas,
  listDueSoonPostingScheduleEntries,
  listUpcomingCalendarEvents,
  markPostingScheduleEntryDone,
  markReviewDone,
  markTodoDone,
} from "@/lib/telegram/chat-tools";

const fetchPostingScheduleCsvMock = vi.mocked(fetchPostingScheduleCsv);

beforeEach(async () => {
  fetchPostingScheduleCsvMock.mockReset();
  await db.delete(tasks);
  await db.delete(contentIdeas);
  await db.delete(clients);
  await db.delete(calendarEventsCache);
  await db.delete(postingScheduleCompletions);
});

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

test("listActiveReviews returns only active reviews with id/title/clientName, excluding todos and completed/snoozed", async () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const [client] = await db.insert(clients).values({ tag: "x", displayName: "X", recognized: true }).returning();
  await db.insert(tasks).values([
    { type: "review", title: "r1", status: "active", clientId: client.id },
    { type: "review", title: "r2", status: "completed" },
    { type: "review", title: "r3", status: "active", snoozedUntil: new Date("2026-02-01T00:00:00Z") },
    { type: "todo", title: "t", status: "active" },
  ]);
  const result = await listActiveReviews(now);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ title: "r1", clientName: "X" });
});

test("listActiveReviews returns clientName null for a review with no client", async () => {
  await db.insert(tasks).values({ type: "review", title: "r", status: "active" });
  const result = await listActiveReviews(new Date());
  expect(result[0].clientName).toBeNull();
});

test("listDueSoonPostingScheduleEntries returns entries due within 3 days, tagged with entryKey/status, excluding completed ones", async () => {
  const now = new Date("2026-01-10T00:00:00Z");
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    "Lovelots,Video A,,10 Jan 2026,,",
    "That Place,Video B,,20 Jan 2026,,",
    "That Place,Video C,,11 Jan 2026,,",
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);
  await db.insert(postingScheduleCompletions).values({
    entryKey: entryKey({ client: "That Place", video: "Video C", postDate: "2026-01-11" }),
  });

  const result = await listDueSoonPostingScheduleEntries(now);
  expect(result.map((e) => e.video)).toEqual(["Video A"]);
  expect(result[0].status).toBe("red");
  expect(result[0].entryKey).toBe(entryKey({ client: "Lovelots", video: "Video A", postDate: "2026-01-10" }));
});

test("listUpcomingCalendarEvents returns events ending now-or-later and starting within the next 14 days", async () => {
  const now = new Date("2026-01-01T00:00:00Z");
  await db.insert(calendarEventsCache).values([
    { googleEventId: "a", title: "Soon", startAt: new Date("2026-01-05T00:00:00Z"), endAt: new Date("2026-01-05T01:00:00Z") },
    { googleEventId: "b", title: "Far", startAt: new Date("2026-02-01T00:00:00Z"), endAt: new Date("2026-02-01T01:00:00Z") },
    { googleEventId: "c", title: "Past", startAt: new Date("2025-12-01T00:00:00Z"), endAt: new Date("2025-12-01T01:00:00Z") },
  ]);
  const result = await listUpcomingCalendarEvents(now);
  expect(result.map((e) => e.title)).toEqual(["Soon"]);
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

test("markReviewDone completes a review and returns true, and false for a todo's id without completing it", async () => {
  const [review] = await db.insert(tasks).values({ type: "review", title: "r", status: "active" }).returning();
  expect(await markReviewDone(review.id, new Date())).toBe(true);
  const [todo] = await db.insert(tasks).values({ type: "todo", title: "t", status: "active" }).returning();
  expect(await markReviewDone(todo.id, new Date())).toBe(false);
  const [unchangedTodo] = await db.select().from(tasks).where(eq(tasks.id, todo.id));
  expect(unchangedTodo.status).toBe("active");
});

test("markPostingScheduleEntryDone returns true and records completion when the key matches a real sheet entry", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    "Lovelots,Video A,,10 Jan 2026,,",
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);
  const key = entryKey({ client: "Lovelots", video: "Video A", postDate: "2026-01-10" });

  const result = await markPostingScheduleEntryDone(key);

  expect(result).toBe(true);
  const rows = await db.select().from(postingScheduleCompletions);
  expect(rows.map((r) => r.entryKey)).toContain(key);
});

test("markPostingScheduleEntryDone returns false and writes nothing for a key matching no sheet entry", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    "Lovelots,Video A,,10 Jan 2026,,",
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);

  const result = await markPostingScheduleEntryDone("Nonexistent|Video|2026-01-01");

  expect(result).toBe(false);
  expect(await db.select().from(postingScheduleCompletions)).toHaveLength(0);
});

test("listContentIdeas filters by clientId when given", async () => {
  const [a] = await db.insert(clients).values({ tag: "a", displayName: "A", recognized: true }).returning();
  const [b] = await db.insert(clients).values({ tag: "b", displayName: "B", recognized: true }).returning();
  await db.insert(contentIdeas).values([{ clientId: a.id, text: "idea a" }, { clientId: b.id, text: "idea b" }]);
  const result = await listContentIdeas(a.id);
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("idea a");
});

test("listContentIdeas returns all ideas when clientId is null", async () => {
  const [a] = await db.insert(clients).values({ tag: "a", displayName: "A", recognized: true }).returning();
  await db.insert(contentIdeas).values([{ clientId: a.id, text: "idea a" }]);
  const result = await listContentIdeas(null);
  expect(result).toHaveLength(1);
});
