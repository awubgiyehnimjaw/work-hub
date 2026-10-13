import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { refreshGoogleToken } from "@/lib/calendar/oauth";

/**
 * Google Calendar API v3 client for fetching Callum's upcoming events.
 *
 * Verified (not guessed) shape of the real, stable Calendar v3 events
 * endpoint: `GET /calendars/primary/events` with query params `timeMin`
 * (RFC3339), `timeMax`, `singleEvents=true` (expands recurring events into
 * individual instances), `orderBy=startTime`, header
 * `Authorization: Bearer <access_token>`. Response:
 * `{ items: [{ id, summary, start: { dateTime?, date? }, end: { dateTime?, date? }, location?, status }, ...] }`.
 *
 * `start`/`end` use `dateTime` for timed events and `date` (date-only, no
 * time) for all-day events — `resolveDateTimeField` below handles both.
 * `status` can be `"cancelled"` for a deleted-but-still-returned event
 * within the time window; those are filtered out here so callers never see
 * a cancelled event as upcoming — `refreshCalendarCache`'s normal
 * delete-missing logic then takes care of dropping it from the cache if it
 * had previously been cached.
 *
 * Important 11: Google's `end.date` for an all-day event is EXCLUSIVE —
 * one calendar day past the event's actual last day (e.g. a single-day
 * event spanning just "2026-02-01" is returned as
 * `start.date: "2026-02-01"`, `end.date: "2026-02-02"`). `toGoogleCalendarEvent`
 * normalizes this into an INCLUSIVE end instant (one millisecond before
 * that exclusive midnight) at the one place this API's quirk is read, so
 * every downstream consumer — the cache, the `GET /api/calendar` response,
 * `CalendarAgenda`'s day-range display — sees the event's real last day
 * without re-deriving this themselves, and without the resulting instant
 * being functionally any different from Google's for "has this event's
 * window passed" purposes (it's 1ms earlier, not a full day earlier).
 */

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  location?: string;
  allDay: boolean;
}

interface GoogleEventDateTime {
  dateTime?: string;
  date?: string;
}

interface GoogleCalendarApiEvent {
  id: string;
  summary?: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  location?: string;
  status: string;
}

interface GoogleCalendarEventsResponse {
  items: GoogleCalendarApiEvent[];
}

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

// Placeholder used when an event has no `summary` at all (Google allows
// untitled events) — never fabricated per-event content, just a fixed,
// honest label.
const NO_TITLE_PLACEHOLDER = "(No title)";

// Refresh proactively once the stored access token is within this long of
// expiring, rather than waiting for a request to fail with a 401 — Google
// access tokens are short-lived (~1 hour), same as Frame.io's (Task 6), so
// a bare fetch interval of a few minutes would otherwise eventually
// straddle an expiry. Mirrors `lib/frameio/client.ts` exactly.
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

async function getOauthTokensRow() {
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"));

  if (!row) {
    throw new Error(
      "Google is not connected (no oauthTokens row for provider 'google')",
    );
  }

  return row;
}

async function getAccessToken(): Promise<string> {
  const row = await getOauthTokensRow();

  const isNearOrPastExpiry =
    row.expiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS <= Date.now();
  if (!isNearOrPastExpiry) {
    return row.accessToken;
  }

  await refreshGoogleToken();
  const refreshed = await getOauthTokensRow();
  return refreshed.accessToken;
}

function resolveDateTimeField(field: GoogleEventDateTime, eventId: string): string {
  if (field.dateTime) {
    return field.dateTime;
  }
  if (field.date) {
    return field.date;
  }
  throw new Error(
    `Google Calendar event ${eventId} has neither dateTime nor date on a start/end field`,
  );
}

/**
 * Converts Google's EXCLUSIVE all-day `end.date` (the calendar day AFTER
 * the event's real last day, always a bare `YYYY-MM-DD` with no time
 * component) into an inclusive instant: one millisecond before that
 * exclusive midnight, which is still unambiguously ON the real last day
 * when only its UTC calendar date is read (as `CalendarAgenda` does for
 * display), while remaining just as "in the future" as Google's own value
 * for any instant-comparison purposes (e.g. the `GET /api/calendar`
 * window filter) — practically identical to Google's exclusive boundary,
 * just anchored to the correct day.
 */
function toInclusiveAllDayEndInstant(exclusiveEndDate: string): string {
  const exclusiveMidnightUtcMs = Date.parse(`${exclusiveEndDate}T00:00:00.000Z`);
  return new Date(exclusiveMidnightUtcMs - 1).toISOString();
}

function toGoogleCalendarEvent(entry: GoogleCalendarApiEvent): GoogleCalendarEvent {
  const allDay = entry.start.date !== undefined;
  const rawEndAt = resolveDateTimeField(entry.end, entry.id);

  return {
    id: entry.id,
    title: entry.summary ?? NO_TITLE_PLACEHOLDER,
    startAt: resolveDateTimeField(entry.start, entry.id),
    endAt: allDay ? toInclusiveAllDayEndInstant(rawEndAt) : rawEndAt,
    location: entry.location,
    allDay,
  };
}

/**
 * Lists events on Callum's primary Google Calendar starting now through
 * `withinDays` days from now, with recurring events expanded into
 * individual instances. Cancelled-but-returned events are excluded.
 */
export async function listUpcomingEvents(
  withinDays: number,
): Promise<GoogleCalendarEvent[]> {
  const accessToken = await getAccessToken();

  const timeMin = new Date().toISOString();
  const timeMax = new Date(
    Date.now() + withinDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const url = new URL(`${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Google Calendar API request failed: ${response.status} ${body}`,
    );
  }

  const data = (await response.json()) as GoogleCalendarEventsResponse;

  return data.items
    .filter((entry) => entry.status !== "cancelled")
    .map(toGoogleCalendarEvent);
}
