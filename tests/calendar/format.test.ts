import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { formatEventTiming } from "@/lib/calendar/format";

test("formats a timed event as a date + time range", () => {
  const result = formatEventTiming({
    startAt: "2026-01-05T10:00:00.000Z",
    endAt: "2026-01-05T11:00:00.000Z",
    allDay: false,
  });

  // Exact wording depends on the test runner's locale/timezone (Intl with
  // `undefined` locale/no timeZone override), so assert structure rather
  // than an exact string: a date portion, a comma, and a time range with
  // an en dash, no "All day" text.
  expect(result).toContain(",");
  expect(result).toContain("–");
  expect(result).not.toContain("All day");
});

// Important 11 regression coverage: an all-day event must render "All day"
// instead of a nonsense time range like "1:00 AM–1:00 AM".

test("formats a single-day all-day event as one date + 'All day', with no time range", () => {
  const result = formatEventTiming({
    startAt: "2026-02-01T00:00:00.000Z",
    endAt: "2026-02-01T23:59:59.999Z",
    allDay: true,
  });

  expect(result).toContain("All day");
  expect(result).not.toMatch(/\d{1,2}:\d{2}/); // no clock time anywhere
  expect(result).not.toContain("–"); // single day: no date range dash
});

test("formats a multi-day all-day event as a date RANGE + 'All day'", () => {
  const result = formatEventTiming({
    startAt: "2026-02-01T00:00:00.000Z",
    endAt: "2026-02-03T23:59:59.999Z",
    allDay: true,
  });

  expect(result).toContain("All day");
  expect(result).toContain("–");
  expect(result).not.toMatch(/\d{1,2}:\d{2}/);
});

// The core Important 11 timezone bug: an all-day event's calendar day must
// never shift depending on the viewer's local timezone offset, because the
// event is stored as a UTC-midnight-anchored instant. Simulate a viewer
// far behind UTC (so local-time formatting would roll the date back to the
// previous day) and confirm the UTC-anchored formatter is immune.
test("an all-day event's displayed day does not shift for a viewer whose local timezone is far behind UTC", () => {
  const originalTz = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu"; // UTC-10, no DST
  try {
    const result = formatEventTiming({
      startAt: "2026-02-01T00:00:00.000Z", // midnight UTC Feb 1
      endAt: "2026-02-01T23:59:59.999Z",
      allDay: true,
    });

    // In Honolulu local time, midnight UTC Feb 1 is 2pm Jan 31 — a
    // local-timezone formatter would (incorrectly) show "Jan 31". The
    // UTC-anchored formatter must still show "Feb 1".
    expect(result).toContain("Feb 1");
    expect(result).not.toContain("Jan 31");
  } finally {
    process.env.TZ = originalTz;
  }
});

test("a timed event's displayed time DOES follow the viewer's local timezone (contrast case)", () => {
  const originalTz = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu";
  try {
    const result = formatEventTiming({
      startAt: "2026-02-01T00:00:00.000Z", // midnight UTC = 2pm Jan 31 Honolulu
      endAt: "2026-02-01T01:00:00.000Z",
      allDay: false,
    });

    expect(result).toContain("Jan 31");
  } finally {
    process.env.TZ = originalTz;
  }
});
