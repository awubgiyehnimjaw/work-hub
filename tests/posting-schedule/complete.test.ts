import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";
import { completePostingScheduleEntry } from "@/lib/posting-schedule/complete";

beforeEach(async () => {
  await db.delete(postingScheduleCompletions);
});

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
