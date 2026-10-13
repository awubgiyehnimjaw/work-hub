import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { listUpcomingEvents } from "@/lib/calendar/google-client";
import { refreshGoogleToken } from "@/lib/calendar/oauth";

// `refreshGoogleToken` lives in oauth.ts; google-client.ts calls it when the
// stored token is at/near expiry. Mocked here (mirroring
// tests/frameio/client.test.ts) so refresh-triggering tests can assert it
// was called without needing a real Google token endpoint — tests of the
// refresh implementation itself live in oauth.test.ts.
vi.mock("@/lib/calendar/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/calendar/oauth")>(
    "@/lib/calendar/oauth",
  );
  return {
    ...actual,
    refreshGoogleToken: vi.fn(),
  };
});

const mockRefreshGoogleToken = refreshGoogleToken as unknown as ReturnType<typeof vi.fn>;

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

beforeEach(async () => {
  mockRefreshGoogleToken.mockReset().mockResolvedValue(undefined);
  await db.delete(oauthTokens);
  await db.insert(oauthTokens).values({
    provider: "google",
    accessToken: "test-access-token",
    refreshToken: "test-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000),
  });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("listUpcomingEvents hits the real Calendar v3 endpoint with timeMin/timeMax/singleEvents/orderBy and bearer auth", async () => {
  const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
    jsonResponse({ items: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);

  await listUpcomingEvents(14);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string | URL, RequestInit];
  const parsed = new URL(url.toString());

  expect(parsed.origin + parsed.pathname).toBe(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  expect(parsed.searchParams.get("timeMin")).toBe("2026-01-01T00:00:00.000Z");
  expect(parsed.searchParams.get("timeMax")).toBe("2026-01-15T00:00:00.000Z");
  expect(parsed.searchParams.get("singleEvents")).toBe("true");
  expect(parsed.searchParams.get("orderBy")).toBe("startTime");

  const headers = init.headers as Record<string, string>;
  expect(headers.Authorization).toBe("Bearer test-access-token");
});

test("listUpcomingEvents maps a timed event's start/end dateTime fields and location", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "evt-1",
            summary: "Client call",
            start: { dateTime: "2026-01-05T10:00:00.000Z" },
            end: { dateTime: "2026-01-05T11:00:00.000Z" },
            location: "Zoom",
            status: "confirmed",
          },
        ],
      }),
    ),
  );

  const events = await listUpcomingEvents(14);

  expect(events).toEqual([
    {
      id: "evt-1",
      title: "Client call",
      startAt: "2026-01-05T10:00:00.000Z",
      endAt: "2026-01-05T11:00:00.000Z",
      location: "Zoom",
    },
  ]);
});

test("listUpcomingEvents maps an all-day event's date-only start/end without crashing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "evt-allday",
            summary: "Out of office",
            start: { date: "2026-02-01" },
            end: { date: "2026-02-02" },
            status: "confirmed",
          },
        ],
      }),
    ),
  );

  const events = await listUpcomingEvents(14);

  expect(events).toEqual([
    {
      id: "evt-allday",
      title: "Out of office",
      startAt: "2026-02-01",
      endAt: "2026-02-02",
      location: undefined,
    },
  ]);
});

test("listUpcomingEvents excludes events with status 'cancelled'", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "evt-live",
            summary: "Still on",
            start: { dateTime: "2026-01-05T10:00:00.000Z" },
            end: { dateTime: "2026-01-05T11:00:00.000Z" },
            status: "confirmed",
          },
          {
            id: "evt-cancelled",
            summary: "Deleted but still returned in the window",
            start: { dateTime: "2026-01-06T10:00:00.000Z" },
            end: { dateTime: "2026-01-06T11:00:00.000Z" },
            status: "cancelled",
          },
        ],
      }),
    ),
  );

  const events = await listUpcomingEvents(14);

  expect(events.map((e) => e.id)).toEqual(["evt-live"]);
});

test("listUpcomingEvents falls back to a placeholder title when summary is missing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      jsonResponse({
        items: [
          {
            id: "evt-no-title",
            start: { dateTime: "2026-01-05T10:00:00.000Z" },
            end: { dateTime: "2026-01-05T11:00:00.000Z" },
            status: "confirmed",
          },
        ],
      }),
    ),
  );

  const events = await listUpcomingEvents(14);

  expect(events[0].title).toBe("(No title)");
});

test("listUpcomingEvents throws when Google is not connected (no oauthTokens row)", async () => {
  await db.delete(oauthTokens);
  vi.stubGlobal("fetch", vi.fn());

  await expect(listUpcomingEvents(14)).rejects.toThrow(/not connected/i);
});

test("listUpcomingEvents refreshes the access token when it is within 5 minutes of expiring, before making any Calendar request", async () => {
  await db
    .update(oauthTokens)
    .set({ expiresAt: new Date(Date.now() + 60_000) }) // 1 minute left, under the 5-minute buffer
    .where(eq(oauthTokens.provider, "google"));

  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [] })));

  await listUpcomingEvents(14);

  expect(mockRefreshGoogleToken).toHaveBeenCalledTimes(1);
});

test("listUpcomingEvents does not refresh the access token when it still has more than 5 minutes left", async () => {
  // beforeEach already seeds a token expiring in 1 hour.
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ items: [] })));

  await listUpcomingEvents(14);

  expect(mockRefreshGoogleToken).not.toHaveBeenCalled();
});

test("listUpcomingEvents throws when the Calendar API responds with a non-2xx status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("forbidden", { status: 403 })),
  );

  await expect(listUpcomingEvents(14)).rejects.toThrow();
});
