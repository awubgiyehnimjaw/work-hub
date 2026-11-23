import { randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { dismissTask } from "@/lib/tasks/dismiss";

beforeEach(async () => {
  await db.delete(tasks);
});

test("dismissTask sets status to dismissed", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "x", status: "active" }).returning();
  const result = await dismissTask(task.id);
  expect(result?.status).toBe("dismissed");
});

test("dismissTask returns null for an unknown id", async () => {
  expect(await dismissTask(randomUUID())).toBeNull();
});

test("dismissTask does nothing to an already-completed task (a stale button press)", async () => {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: "x", status: "completed", completedAt: new Date("2026-01-01T00:00:00Z") })
    .returning();
  const result = await dismissTask(task.id);
  expect(result).toBeNull();
  const [row] = await db.select().from(tasks);
  expect(row.status).toBe("completed");
});
