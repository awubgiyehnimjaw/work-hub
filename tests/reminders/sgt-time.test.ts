import { expect, test } from "vitest";
import { isQuietHoursSgt, startOfTomorrowSgt, tomorrowNineAmSgt } from "@/lib/reminders/sgt-time";

test("isQuietHoursSgt is true at 11:30pm SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-01T15:30:00Z"))).toBe(true); // 23:30 SGT
});
test("isQuietHoursSgt is true at 7:30am SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-01T23:30:00Z"))).toBe(true); // 07:30 SGT
});
test("isQuietHoursSgt is false at 8:00am SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-02T00:00:00Z"))).toBe(false); // 08:00 SGT
});
test("isQuietHoursSgt is false at noon SGT", () => {
  expect(isQuietHoursSgt(new Date("2026-01-01T04:00:00Z"))).toBe(false); // 12:00 SGT
});

test("tomorrowNineAmSgt returns 9am SGT the next SGT calendar day", () => {
  // 2026-01-01T10:00:00Z = 2026-01-01 18:00 SGT
  expect(tomorrowNineAmSgt(new Date("2026-01-01T10:00:00Z"))).toEqual(new Date("2026-01-02T01:00:00Z"));
});
test("tomorrowNineAmSgt rolls over across a year boundary", () => {
  // 2025-12-31 18:00 SGT
  expect(tomorrowNineAmSgt(new Date("2025-12-31T10:00:00Z"))).toEqual(new Date("2026-01-01T01:00:00Z"));
});

test("startOfTomorrowSgt returns midnight SGT the next SGT calendar day", () => {
  expect(startOfTomorrowSgt(new Date("2026-01-01T10:00:00Z"))).toEqual(new Date("2026-01-01T16:00:00Z"));
});
