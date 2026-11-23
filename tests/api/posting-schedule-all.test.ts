import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";

vi.mock("@/lib/posting-schedule/sheet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/posting-schedule/sheet")>("@/lib/posting-schedule/sheet");
  return { ...actual, fetchPostingScheduleCsv: vi.fn() };
});

import { entryKey, fetchPostingScheduleCsv } from "@/lib/posting-schedule/sheet";
import { GET } from "@/app/api/posting-schedule/all/route";

const fetchPostingScheduleCsvMock = vi.mocked(fetchPostingScheduleCsv);

beforeEach(async () => {
  fetchPostingScheduleCsvMock.mockReset();
  await db.delete(postingScheduleCompletions);
});

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
