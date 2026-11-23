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
