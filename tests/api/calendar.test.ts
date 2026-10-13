import { beforeEach, expect, test } from "vitest";
import { GET } from "@/app/api/calendar/route";
import { db } from "@/lib/db/client";
import { calendarEventsCache } from "@/lib/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

beforeEach(async () => {
  await db.delete(calendarEventsCache);
});

function event(overrides: Partial<typeof calendarEventsCache.$inferInsert>) {
  const now = Date.now();
  return {
    googleEventId: "evt-default",
    title: "Default event",
    startAt: new Date(now + HOUR_MS),
    endAt: new Date(now + 2 * HOUR_MS),
    location: null,
    ...overrides,
  };
}

test("GET /api/calendar returns cached events sorted chronologically", async () => {
  const now = Date.now();
  await db.insert(calendarEventsCache).values([
    event({
      googleEventId: "evt-later",
      title: "Later event",
      startAt: new Date(now + 3 * DAY_MS),
      endAt: new Date(now + 3 * DAY_MS + HOUR_MS),
    }),
    event({
      googleEventId: "evt-sooner",
      title: "Sooner event",
      startAt: new Date(now + DAY_MS),
      endAt: new Date(now + DAY_MS + HOUR_MS),
    }),
  ]);

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.map((e: { title: string }) => e.title)).toEqual([
    "Sooner event",
    "Later event",
  ]);
});

test("GET /api/calendar excludes an event that has already ended", async () => {
  const now = Date.now();
  await db.insert(calendarEventsCache).values(
    event({
      googleEventId: "evt-past",
      title: "Finished yesterday",
      startAt: new Date(now - 2 * DAY_MS),
      endAt: new Date(now - DAY_MS),
    }),
  );

  const res = await GET();
  const body = await res.json();
  expect(body).toHaveLength(0);
});

test("GET /api/calendar includes an event currently in progress", async () => {
  const now = Date.now();
  await db.insert(calendarEventsCache).values(
    event({
      googleEventId: "evt-live",
      title: "Happening right now",
      startAt: new Date(now - HOUR_MS),
      endAt: new Date(now + HOUR_MS),
    }),
  );

  const res = await GET();
  const body = await res.json();
  expect(body).toHaveLength(1);
  expect(body[0].title).toBe("Happening right now");
});

test("GET /api/calendar excludes an event starting more than 14 days out", async () => {
  const now = Date.now();
  await db.insert(calendarEventsCache).values(
    event({
      googleEventId: "evt-far",
      title: "Far future event",
      startAt: new Date(now + 20 * DAY_MS),
      endAt: new Date(now + 20 * DAY_MS + HOUR_MS),
    }),
  );

  const res = await GET();
  const body = await res.json();
  expect(body).toHaveLength(0);
});

test("GET /api/calendar returns an empty array when the cache is empty", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});
