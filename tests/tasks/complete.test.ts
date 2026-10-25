import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, tasks } from "@/lib/db/schema";
import { completeTask } from "@/lib/tasks/complete";

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(clients);
});

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
