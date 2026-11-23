import { randomUUID } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram/client";
import { handleCallbackQuery } from "@/lib/telegram/callback-handler";

vi.mock("@/lib/telegram/client", () => ({
  editMessageText: vi.fn().mockResolvedValue(undefined),
  answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  await db.delete(tasks);
  vi.mocked(editMessageText).mockClear();
  vi.mocked(answerCallbackQuery).mockClear();
});

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

test("a stale done action on an already-completed task reports 'already handled', not success", async () => {
  const completedAt = new Date("2026-01-01T00:00:00Z");
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "completed", completedAt })
    .returning();
  await handleCallbackQuery(123, 456, "cb-1", `td|done|${task.id}`, new Date("2026-01-02T00:00:00Z"));
  expect(vi.mocked(editMessageText)).toHaveBeenCalledWith(123, 456, expect.stringMatching(/couldn't find|not found/i), []);
  const [row] = await db.select().from(tasks);
  expect(row.completedAt).toEqual(completedAt); // not overwritten by the stale press
  expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalledWith("cb-1");
});

test("a stale drop action on an already-completed task leaves it completed", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "completed", completedAt: new Date() })
    .returning();
  await handleCallbackQuery(123, 456, "cb-1", `td|drop|${task.id}`, new Date());
  expect(vi.mocked(editMessageText)).toHaveBeenCalledWith(123, 456, expect.stringMatching(/couldn't find|not found/i), []);
  const [row] = await db.select().from(tasks);
  expect(row.status).toBe("completed");
});

test("answerCallbackQuery still fires even if the action throws (e.g. a malformed task id)", async () => {
  await expect(handleCallbackQuery(123, 456, "cb-1", "td|done|not-a-uuid", new Date())).resolves.not.toThrow();
  expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalledWith("cb-1");
});

test("an unknown action answers the callback and does not throw", async () => {
  await expect(handleCallbackQuery(123, 456, "cb-1", "td|bogus|x", new Date())).resolves.not.toThrow();
  expect(vi.mocked(answerCallbackQuery)).toHaveBeenCalled();
});

test("an action on a nonexistent task id edits the message to say it couldn't be found", async () => {
  await handleCallbackQuery(123, 456, "cb-1", `td|done|${randomUUID()}`, new Date());
  expect(vi.mocked(editMessageText)).toHaveBeenCalledWith(123, 456, expect.stringMatching(/couldn't find|not found/i), []);
});
