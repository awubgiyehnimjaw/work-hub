import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { calendarEventsCache } from "@/lib/db/schema";
import { listUpcomingEvents, type GoogleCalendarEvent } from "@/lib/calendar/google-client";
import { refreshCalendarCache } from "@/lib/calendar/fetch";

// Vitest hoists vi.mock calls above these imports, so listUpcomingEvents is
// already the mocked version by the time refreshCalendarCache (which
// imports it itself) runs — same pattern as tests/frameio/poll.test.ts
// mocking listNewFiles.
vi.mock("@/lib/calendar/google-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calendar/google-client")>(
    "@/lib/calendar/google-client",
  );
  return {
    ...actual,
    listUpcomingEvents: vi.fn(),
  };
});

const mockListUpcomingEvents = listUpcomingEvents as unknown as ReturnType<typeof vi.fn>;

type EventOverrides = Partial<GoogleCalendarEvent>;

function event(overrides: EventOverrides = {}): GoogleCalendarEvent {
  return {
    id: "evt-default",
    title: "Default event",
    startAt: "2026-01-05T10:00:00.000Z",
    endAt: "2026-01-05T11:00:00.000Z",
    location: undefined,
    allDay: false,
    ...overrides,
  };
}

beforeEach(async () => {
  mockListUpcomingEvents.mockReset();
  await db.delete(calendarEventsCache);
});

test("refreshCalendarCache calls listUpcomingEvents(14) and caches new events", async () => {
  mockListUpcomingEvents.mockResolvedValue([
    event({ id: "evt-1", title: "Client call", location: "Zoom" }),
    event({ id: "evt-2", title: "Shoot day" }),
  ]);

  const result = await refreshCalendarCache();

  expect(mockListUpcomingEvents).toHaveBeenCalledWith(14);
  expect(result).toEqual({ cached: 2 });

  const rows = await db.select().from(calendarEventsCache);
  expect(rows).toHaveLength(2);

  const [row1] = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-1"));
  expect(row1.title).toBe("Client call");
  expect(row1.location).toBe("Zoom");
  expect(row1.startAt.toISOString()).toBe("2026-01-05T10:00:00.000Z");
  expect(row1.endAt.toISOString()).toBe("2026-01-05T11:00:00.000Z");
});

test("refreshCalendarCache stores a null location when the event has none", async () => {
  mockListUpcomingEvents.mockResolvedValue([event({ id: "evt-no-location", location: undefined })]);

  await refreshCalendarCache();

  const [row] = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-no-location"));
  expect(row.location).toBeNull();
});

test("refreshCalendarCache updates an existing cached event when its time changes", async () => {
  mockListUpcomingEvents.mockResolvedValue([
    event({
      id: "evt-moved",
      title: "Client call",
      startAt: "2026-01-05T10:00:00.000Z",
      endAt: "2026-01-05T11:00:00.000Z",
    }),
  ]);
  await refreshCalendarCache();

  // The event gets rescheduled an hour later.
  mockListUpcomingEvents.mockResolvedValue([
    event({
      id: "evt-moved",
      title: "Client call",
      startAt: "2026-01-05T11:00:00.000Z",
      endAt: "2026-01-05T12:00:00.000Z",
    }),
  ]);
  const result = await refreshCalendarCache();

  expect(result).toEqual({ cached: 1 });
  const rows = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-moved"));
  expect(rows).toHaveLength(1);
  expect(rows[0].startAt.toISOString()).toBe("2026-01-05T11:00:00.000Z");
  expect(rows[0].endAt.toISOString()).toBe("2026-01-05T12:00:00.000Z");
});

test("refreshCalendarCache deletes a cached event that is no longer returned", async () => {
  mockListUpcomingEvents.mockResolvedValue([
    event({ id: "evt-keep" }),
    event({ id: "evt-removed" }),
  ]);
  await refreshCalendarCache();
  expect(await db.select().from(calendarEventsCache)).toHaveLength(2);

  // Second run: evt-removed is gone (cancelled, or simply outside the
  // window now) — only evt-keep comes back.
  mockListUpcomingEvents.mockResolvedValue([event({ id: "evt-keep" })]);
  const result = await refreshCalendarCache();

  expect(result).toEqual({ cached: 1 });
  const rows = await db.select().from(calendarEventsCache);
  expect(rows.map((r) => r.googleEventId)).toEqual(["evt-keep"]);
});

test("refreshCalendarCache deletes every cached row when listUpcomingEvents returns nothing", async () => {
  mockListUpcomingEvents.mockResolvedValue([event({ id: "evt-solo" })]);
  await refreshCalendarCache();
  expect(await db.select().from(calendarEventsCache)).toHaveLength(1);

  mockListUpcomingEvents.mockResolvedValue([]);
  const result = await refreshCalendarCache();

  expect(result).toEqual({ cached: 0 });
  expect(await db.select().from(calendarEventsCache)).toHaveLength(0);
});

test("refreshCalendarCache handles an all-day (date-only) event without crashing", async () => {
  mockListUpcomingEvents.mockResolvedValue([
    event({
      id: "evt-allday",
      title: "Out of office",
      startAt: "2026-02-01",
      endAt: "2026-02-01T23:59:59.999Z",
      allDay: true,
    }),
  ]);

  const result = await refreshCalendarCache();

  expect(result).toEqual({ cached: 1 });
  const [row] = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-allday"));
  expect(row.startAt).toBeInstanceOf(Date);
  expect(row.endAt).toBeInstanceOf(Date);
});

// Important 11 regression coverage: the allDay flag itself must flow
// through the cache, both on first insert and on a later update.

test("refreshCalendarCache stores allDay: true for an all-day event", async () => {
  mockListUpcomingEvents.mockResolvedValue([
    event({ id: "evt-allday", allDay: true, startAt: "2026-02-01", endAt: "2026-02-01T23:59:59.999Z" }),
  ]);

  await refreshCalendarCache();

  const [row] = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-allday"));
  expect(row.allDay).toBe(true);
});

test("refreshCalendarCache stores allDay: false for a timed event", async () => {
  mockListUpcomingEvents.mockResolvedValue([event({ id: "evt-timed", allDay: false })]);

  await refreshCalendarCache();

  const [row] = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-timed"));
  expect(row.allDay).toBe(false);
});

test("refreshCalendarCache updates allDay on an existing cached row when it changes", async () => {
  mockListUpcomingEvents.mockResolvedValue([event({ id: "evt-changes", allDay: false })]);
  await refreshCalendarCache();

  mockListUpcomingEvents.mockResolvedValue([
    event({
      id: "evt-changes",
      allDay: true,
      startAt: "2026-02-01",
      endAt: "2026-02-01T23:59:59.999Z",
    }),
  ]);
  await refreshCalendarCache();

  const [row] = await db
    .select()
    .from(calendarEventsCache)
    .where(eq(calendarEventsCache.googleEventId, "evt-changes"));
  expect(row.allDay).toBe(true);
});
