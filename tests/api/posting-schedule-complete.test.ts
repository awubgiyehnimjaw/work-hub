import { beforeEach, expect, test } from "vitest";
import { POST } from "@/app/api/posting-schedule/complete/route";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/posting-schedule/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await db.delete(postingScheduleCompletions);
});

test("POST /api/posting-schedule/complete records the entry as completed", async () => {
  const res = await POST(postRequest({ entryKey: "That Place|Montage|2026-10-20" }));

  expect(res.status).toBe(200);
  const [row] = await db.select().from(postingScheduleCompletions);
  expect(row.entryKey).toBe("That Place|Montage|2026-10-20");
  expect(row.completedAt).not.toBeNull();
});

test("POST /api/posting-schedule/complete is idempotent — pressing Done twice doesn't error", async () => {
  await POST(postRequest({ entryKey: "That Place|Montage|2026-10-20" }));
  const res = await POST(postRequest({ entryKey: "That Place|Montage|2026-10-20" }));

  expect(res.status).toBe(200);
  const rows = await db.select().from(postingScheduleCompletions);
  expect(rows).toHaveLength(1);
});

test("POST /api/posting-schedule/complete rejects a missing entryKey", async () => {
  const res = await POST(postRequest({}));
  expect(res.status).toBe(400);
});

test("POST /api/posting-schedule/complete rejects an empty entryKey", async () => {
  const res = await POST(postRequest({ entryKey: "" }));
  expect(res.status).toBe(400);
});
