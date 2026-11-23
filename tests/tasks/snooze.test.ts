import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { snoozeTask } from "@/lib/tasks/snooze";

beforeEach(async () => {
  await db.delete(tasks);
});

test("snoozeTask sets snoozedUntil and leaves dueAt untouched", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "active", dueAt: new Date("2026-01-01T00:00:00Z") })
    .returning();
  const until = new Date("2026-01-02T01:00:00Z");
  const result = await snoozeTask(task.id, until);
  expect(result?.snoozedUntil).toEqual(until);
  expect(result?.dueAt).toEqual(new Date("2026-01-01T00:00:00Z"));
});

test("snoozeTask returns null for an unknown id", async () => {
  expect(await snoozeTask(randomUUID(), new Date())).toBeNull();
});

test("snoozeTask does nothing to an already-completed task (a stale button press)", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "completed", completedAt: new Date("2026-01-01T00:00:00Z") })
    .returning();
  const result = await snoozeTask(task.id, new Date("2026-01-02T00:00:00Z"));
  expect(result).toBeNull();
  const [row] = await db.select().from(tasks);
  expect(row.status).toBe("completed");
  expect(row.snoozedUntil).toBeNull();
});

test("snoozeTask clears telegramNagSentAt so a shorter snooze actually shortens the next nag", async () => {
  // Final-review Important: without this, re-nagging still waits for the
  // original 3-hour-since-last-nag window regardless of how short a
  // snooze was requested, so "Snooze 1h" silently behaved exactly like
  // ignoring the nag (the next nag came at the same time either way).
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "active", telegramNagSentAt: new Date("2026-01-01T00:00:00Z") })
    .returning();
  const result = await snoozeTask(task.id, new Date("2026-01-01T01:00:00Z"));
  expect(result?.telegramNagSentAt).toBeNull();
});
