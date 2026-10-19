import { expect, test } from "vitest";
import {
  classifyPostingScheduleStatus,
  entryKey,
  filterByNotCompleted,
  filterDueSoon,
  parsePostingScheduleCsv,
  sgtDateKey,
  type PostingScheduleEntry,
} from "@/lib/posting-schedule/sheet";

const SAMPLE_CSV = [
  "Client,Video,Edit By,Post Date,Notes,Posted",
  "HappyFish Swim,Bonding,,,DONE,",
  "Catch Seafood,Migrant Worker 4,,,HOLD,",
  "Lovelots,time to buy,02 Oct 2026,05 Oct 2026,,",
  "That Place,Creme Brulee Latte,15 Oct 2026,16 Oct 2026,,",
].join("\n");

test("parsePostingScheduleCsv drops the header row and parses each entry", () => {
  const entries = parsePostingScheduleCsv(SAMPLE_CSV);
  expect(entries).toHaveLength(4);
  expect(entries[0]).toEqual({ client: "HappyFish Swim", video: "Bonding", postDate: null, notes: "DONE" });
});

test("parsePostingScheduleCsv converts the sheet's \"DD Mon YYYY\" date into \"YYYY-MM-DD\"", () => {
  const entries = parsePostingScheduleCsv(SAMPLE_CSV);
  const creme = entries.find((e) => e.video === "Creme Brulee Latte");
  expect(creme?.postDate).toBe("2026-10-16");
});

test("parsePostingScheduleCsv treats a blank Post Date as null", () => {
  const entries = parsePostingScheduleCsv(SAMPLE_CSV);
  const bonding = entries.find((e) => e.video === "Bonding");
  expect(bonding?.postDate).toBeNull();
});

test("parsePostingScheduleCsv treats a blank Notes cell as null, not an empty string", () => {
  const entries = parsePostingScheduleCsv(SAMPLE_CSV);
  const timeToBuy = entries.find((e) => e.video === "time to buy");
  expect(timeToBuy?.notes).toBeNull();
});

test("parsePostingScheduleCsv honors a quoted field containing a comma", () => {
  const csv = ['Client,Video,Edit By,Post Date,Notes,Posted', '"That Place","Salmon, Mentaiko",,16 Oct 2026,,'].join("\n");
  const entries = parsePostingScheduleCsv(csv);
  expect(entries[0].video).toBe("Salmon, Mentaiko");
});

test("sgtDateKey converts a UTC instant to Singapore's calendar date, which can be a day ahead", () => {
  // 2026-10-15T20:00:00Z is 2026-10-16T04:00 in Singapore (UTC+8) — the next calendar day.
  expect(sgtDateKey(new Date("2026-10-15T20:00:00Z"))).toBe("2026-10-16");
});

test("sgtDateKey keeps the same calendar date when the UTC instant is still the same SGT day", () => {
  // 2026-10-16T01:00:00Z is 2026-10-16T09:00 in Singapore — same day.
  expect(sgtDateKey(new Date("2026-10-16T01:00:00Z"))).toBe("2026-10-16");
});

function entry(overrides: Partial<PostingScheduleEntry>): PostingScheduleEntry {
  return { client: "Test Co", video: "Test Video", postDate: null, notes: null, ...overrides };
}

const NOW = new Date("2026-10-16T01:00:00Z"); // 2026-10-16 09:00 SGT

test("filterDueSoon includes an entry due today", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-16" })], NOW);
  expect(result).toHaveLength(1);
});

test("filterDueSoon includes an entry due exactly 3 days from now", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-19" })], NOW);
  expect(result).toHaveLength(1);
});

test("filterDueSoon excludes an entry due 4 days from now", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-20" })], NOW);
  expect(result).toHaveLength(0);
});

test("filterDueSoon includes an entry whose post date has already passed — overdue entries stay until marked done", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-15" })], NOW);
  expect(result).toHaveLength(1);
});

test("filterDueSoon includes an entry far in the past just as readily — no auto-expiry on overdue entries", () => {
  const result = filterDueSoon([entry({ postDate: "2026-09-01" })], NOW);
  expect(result).toHaveLength(1);
});

test("filterDueSoon excludes an entry with no post date at all", () => {
  const result = filterDueSoon([entry({ postDate: null })], NOW);
  expect(result).toHaveLength(0);
});

test("filterDueSoon excludes an entry marked DONE even if the date is in range", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-16", notes: "DONE" })], NOW);
  expect(result).toHaveLength(0);
});

test("filterDueSoon excludes an entry marked HOLD (case-insensitive) even if the date is in range", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-16", notes: "hold" })], NOW);
  expect(result).toHaveLength(0);
});

test("filterDueSoon includes an entry with unrelated notes text", () => {
  const result = filterDueSoon([entry({ postDate: "2026-10-16", notes: "needs thumbnail" })], NOW);
  expect(result).toHaveLength(1);
});

test("entryKey combines client, video, and post date into a stable string", () => {
  expect(entryKey(entry({ client: "That Place", video: "Montage", postDate: "2026-10-20" }))).toBe(
    "That Place|Montage|2026-10-20",
  );
});

test("entryKey still produces a key when postDate is null", () => {
  expect(entryKey(entry({ client: "That Place", video: "Montage", postDate: null }))).toBe("That Place|Montage|");
});

test("filterByNotCompleted drops an entry whose key is in the completed set", () => {
  const a = entry({ client: "A", video: "Vid A", postDate: "2026-10-16" });
  const b = entry({ client: "B", video: "Vid B", postDate: "2026-10-17" });
  const result = filterByNotCompleted([a, b], new Set([entryKey(a)]));
  expect(result).toEqual([b]);
});

test("filterByNotCompleted keeps everything when the completed set is empty", () => {
  const a = entry({ client: "A", video: "Vid A", postDate: "2026-10-16" });
  const result = filterByNotCompleted([a], new Set());
  expect(result).toEqual([a]);
});

test("classifyPostingScheduleStatus returns red for an entry due today", () => {
  expect(classifyPostingScheduleStatus("2026-10-16", "2026-10-16")).toBe("red");
});

test("classifyPostingScheduleStatus returns red for an overdue entry", () => {
  expect(classifyPostingScheduleStatus("2026-10-10", "2026-10-16")).toBe("red");
});

test("classifyPostingScheduleStatus returns green for an entry due tomorrow", () => {
  expect(classifyPostingScheduleStatus("2026-10-17", "2026-10-16")).toBe("green");
});

test("classifyPostingScheduleStatus returns none for an entry due 2 or 3 days out", () => {
  expect(classifyPostingScheduleStatus("2026-10-18", "2026-10-16")).toBe("none");
  expect(classifyPostingScheduleStatus("2026-10-19", "2026-10-16")).toBe("none");
});
