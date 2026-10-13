import { and, asc, gte, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { calendarEventsCache } from "@/lib/db/schema";

// Mirrors the 14-day lookahead `refreshCalendarCache` (Task 10) already uses
// when populating this cache. Re-applying the same bound here — rather than
// just trusting the cache to always be freshly within it — keeps this
// route's own contract correct even if the periodic fetch is temporarily
// behind schedule and the cache still holds a row just outside the window.
const WITHIN_DAYS = 14;

/**
 * Calendar agenda for the dashboard: everything in `calendarEventsCache`
 * (Task 10's periodic Google Calendar fetch — this route never calls
 * Google directly) that hasn't already finished and starts within the next
 * 14 days, sorted chronologically. An event currently in progress (started
 * but not yet ended) is still included — `endAt >= now` rather than
 * `startAt >= now` — since it's still relevant to "what's going on today".
 */
export async function GET() {
  const now = new Date();
  const horizon = new Date(now.getTime() + WITHIN_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(calendarEventsCache)
    .where(
      and(
        gte(calendarEventsCache.endAt, now),
        lte(calendarEventsCache.startAt, horizon),
      ),
    )
    .orderBy(asc(calendarEventsCache.startAt));

  return NextResponse.json(rows);
}
