import { describe, expect, test } from "vitest";
import { isTaskStale } from "@/lib/tasks/aging";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-01-10T12:00:00.000Z");

describe("isTaskStale", () => {
  test("a fresh active task is not stale", () => {
    const task = { status: "active", snoozedUntil: null, createdAt: new Date(NOW) };
    expect(isTaskStale(task, NOW)).toBe(false);
  });

  test("a 3-day-old active task is stale", () => {
    const task = {
      status: "active",
      snoozedUntil: null,
      createdAt: new Date(NOW.getTime() - 3 * DAY_MS),
    };
    expect(isTaskStale(task, NOW)).toBe(true);
  });

  test("a completed task is never stale, regardless of age", () => {
    const task = {
      status: "completed",
      snoozedUntil: null,
      createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
    };
    expect(isTaskStale(task, NOW)).toBe(false);
  });

  test("a task snoozed into the future is not stale", () => {
    const task = {
      status: "active",
      snoozedUntil: new Date(NOW.getTime() + DAY_MS),
      createdAt: new Date(NOW.getTime() - 10 * DAY_MS),
    };
    expect(isTaskStale(task, NOW)).toBe(false);
  });

  test("a task whose snoozedUntil is exactly now has reappeared and is stale", () => {
    const task = {
      status: "active",
      snoozedUntil: new Date(NOW.getTime()),
      createdAt: new Date(NOW.getTime() - 10 * DAY_MS),
    };
    expect(isTaskStale(task, NOW)).toBe(true);
  });

  // Not explicitly listed in the brief, but the self-review calls out
  // off-by-one risk on the 2-day threshold, so pin the exact boundary.
  test("a task exactly 2 days old is stale (inclusive boundary)", () => {
    const task = {
      status: "active",
      snoozedUntil: null,
      createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
    };
    expect(isTaskStale(task, NOW)).toBe(true);
  });

  test("a task one minute short of 2 days old is not yet stale", () => {
    const task = {
      status: "active",
      snoozedUntil: null,
      createdAt: new Date(NOW.getTime() - 2 * DAY_MS + 60 * 1000),
    };
    expect(isTaskStale(task, NOW)).toBe(false);
  });
});
