import { expect, test } from "vitest";
import { classifyDueStatus } from "@/lib/tasks/due-status";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-18T00:00:00Z");

test("returns null for a due date more than 1 week away", () => {
  expect(classifyDueStatus(new Date(now.getTime() + 8 * DAY_MS), now)).toBe(null);
});

test("returns green for a due date within 1 week but more than 3 days away", () => {
  expect(classifyDueStatus(new Date(now.getTime() + 7 * DAY_MS), now)).toBe("green");
  expect(classifyDueStatus(new Date(now.getTime() + 4 * DAY_MS), now)).toBe("green");
});

test("returns yellow for a due date within 3 days but more than 1 day away", () => {
  expect(classifyDueStatus(new Date(now.getTime() + 3 * DAY_MS), now)).toBe("yellow");
  expect(classifyDueStatus(new Date(now.getTime() + 2 * DAY_MS), now)).toBe("yellow");
});

test("returns red for a due date within 1 day away", () => {
  expect(classifyDueStatus(new Date(now.getTime() + DAY_MS), now)).toBe("red");
  expect(classifyDueStatus(new Date(now.getTime() + 60 * 1000), now)).toBe("red");
});

test("returns overdue for a due date exactly now or in the past", () => {
  expect(classifyDueStatus(now, now)).toBe("overdue");
  expect(classifyDueStatus(new Date(now.getTime() - DAY_MS), now)).toBe("overdue");
});
