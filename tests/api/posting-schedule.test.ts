import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";

vi.mock("@/lib/posting-schedule/sheet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/posting-schedule/sheet")>("@/lib/posting-schedule/sheet");
  return { ...actual, fetchPostingScheduleCsv: vi.fn() };
});

import { entryKey, fetchPostingScheduleCsv, parsePostingScheduleCsv } from "@/lib/posting-schedule/sheet";
import { GET } from "@/app/api/posting-schedule/due-soon/route";

const fetchPostingScheduleCsvMock = vi.mocked(fetchPostingScheduleCsv);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Formats a day offset from right now (in SGT) as the sheet's own "DD Mon YYYY" string. */
function sheetDateInDays(daysFromNow: number): string {
  const sgtNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Singapore" }));
  sgtNow.setDate(sgtNow.getDate() + daysFromNow);
  const day = String(sgtNow.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[sgtNow.getMonth()]} ${sgtNow.getFullYear()}`;
}

beforeEach(async () => {
  fetchPostingScheduleCsvMock.mockReset();
  await db.delete(postingScheduleCompletions);
});

test("GET /api/posting-schedule/due-soon returns entries due within 3 days, soonest first", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    `Lovelots,ranking (jewelry),,${sheetDateInDays(1)},,`,
    `That Place,Creme Brulee Latte,,${sheetDateInDays(0)},,`,
    `That Place,Montage,,${sheetDateInDays(5)},,`,
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.map((e: { video: string }) => e.video)).toEqual(["Creme Brulee Latte", "ranking (jewelry)"]);
});

test("GET /api/posting-schedule/due-soon keeps an overdue entry and marks it status 'red'", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    `That Place,Late Video,,${sheetDateInDays(-10)},,`,
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);

  const res = await GET();
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0].status).toBe("red");
});

test("GET /api/posting-schedule/due-soon tags each entry with its status and entryKey", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    `That Place,Tomorrow Video,,${sheetDateInDays(1)},,`,
    `That Place,Later Video,,${sheetDateInDays(3)},,`,
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);

  const res = await GET();
  const body = await res.json();
  const tomorrow = body.find((e: { video: string }) => e.video === "Tomorrow Video");
  const later = body.find((e: { video: string }) => e.video === "Later Video");
  expect(tomorrow.status).toBe("green");
  expect(later.status).toBe("none");
  expect(tomorrow.entryKey).toBe(`That Place|Tomorrow Video|${tomorrow.postDate}`);
});

test("GET /api/posting-schedule/due-soon excludes an entry already marked done via the Done button", async () => {
  const csv = [
    "Client,Video,Edit By,Post Date,Notes,Posted",
    `That Place,Finished Video,,${sheetDateInDays(0)},,`,
  ].join("\n");
  fetchPostingScheduleCsvMock.mockResolvedValue(csv);
  const [parsedEntry] = parsePostingScheduleCsv(csv);
  await db.insert(postingScheduleCompletions).values({ entryKey: entryKey(parsedEntry) });

  const res = await GET();
  const body = await res.json();
  expect(body.map((e: { video: string }) => e.video)).not.toContain("Finished Video");
});

test("GET /api/posting-schedule/due-soon returns an empty array when nothing is due soon", async () => {
  fetchPostingScheduleCsvMock.mockResolvedValue("Client,Video,Edit By,Post Date,Notes,Posted\n");

  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("GET /api/posting-schedule/due-soon returns 500 instead of crashing when the sheet fetch fails", async () => {
  fetchPostingScheduleCsvMock.mockRejectedValue(new Error("network error"));

  const res = await GET();
  expect(res.status).toBe(500);
});
