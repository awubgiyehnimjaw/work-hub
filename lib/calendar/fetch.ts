import { notInArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendarEventsCache } from "@/lib/db/schema";
import { listUpcomingEvents } from "@/lib/calendar/google-client";

// How far ahead to pull events — mirrors the brief's "upcoming" window for
// the dashboard. Deliberately a plain constant (not a param on
// `refreshCalendarCache`) since this task has exactly one caller (the cron
// route) and no variable lookahead requirement, unlike Frame.io's
// cursor-based incremental poll.
const WITHIN_DAYS = 14;

/**
 * Refreshes the local `calendarEventsCache` from Google Calendar: fetches
 * everything in the next `WITHIN_DAYS` days and upserts each event keyed on
 * `googleEventId` (so a changed time/location overwrites the cached row),
 * then deletes any cached row whose `googleEventId` is no longer in the
 * freshly-fetched set — covering both "event cancelled" (Google excludes it
 * via `status`, handled in `listUpcomingEvents`) and "event moved outside
 * the window" the same way, since neither case should still show up as
 * upcoming on the dashboard.
 *
 * Simpler than Task 6's Frame.io poll by design (per the brief): no
 * recursion, no pagination, no incremental cursor/dedup — just a full
 * time-window fetch with upsert + delete-missing each run.
 */
export async function refreshCalendarCache(): Promise<{ cached: number }> {
  const events = await listUpcomingEvents(WITHIN_DAYS);

  for (const event of events) {
    await db
      .insert(calendarEventsCache)
      .values({
        googleEventId: event.id,
        title: event.title,
        startAt: new Date(event.startAt),
        endAt: new Date(event.endAt),
        location: event.location ?? null,
        allDay: event.allDay,
      })
      .onConflictDoUpdate({
        target: calendarEventsCache.googleEventId,
        set: {
          title: event.title,
          startAt: new Date(event.startAt),
          endAt: new Date(event.endAt),
          location: event.location ?? null,
          allDay: event.allDay,
        },
      });
  }

  const fetchedIds = events.map((event) => event.id);
  if (fetchedIds.length > 0) {
    await db
      .delete(calendarEventsCache)
      .where(notInArray(calendarEventsCache.googleEventId, fetchedIds));
  } else {
    // notInArray with an empty list would match nothing (or behave
    // inconsistently across drivers) — if nothing came back this run,
    // every cached row is stale and must go.
    await db.delete(calendarEventsCache);
  }

  return { cached: events.length };
}
