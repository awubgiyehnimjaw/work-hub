import { NextRequest } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";
import { GET } from "@/app/api/cron/fetch-calendar/route";
import { refreshCalendarCache } from "@/lib/calendar/fetch";

// Mocked so this test can assert the auth gate runs before ANY side effect
// (DB reads/writes, Calendar API calls) — refreshCalendarCache is the sole
// place those happen, so "was it called at all" is the right proxy for "did
// any side effect happen". Mirrors tests/api/cron-poll-frameio.test.ts.
vi.mock("@/lib/calendar/fetch", () => ({
  refreshCalendarCache: vi.fn(),
}));

const mockRefreshCalendarCache = refreshCalendarCache as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  mockRefreshCalendarCache.mockReset();
});

function cronRequest(authorizationHeader?: string): NextRequest {
  const headers: HeadersInit = {};
  if (authorizationHeader !== undefined) {
    headers["authorization"] = authorizationHeader;
  }
  return new NextRequest(new URL("/api/cron/fetch-calendar", "http://localhost"), {
    headers,
  });
}

test("GET /api/cron/fetch-calendar returns 401 and calls nothing without a valid secret", async () => {
  const res = await GET(cronRequest());

  expect(res.status).toBe(401);
  expect(mockRefreshCalendarCache).not.toHaveBeenCalled();
});

test("GET /api/cron/fetch-calendar returns 401 and calls nothing for a wrong bearer token", async () => {
  const res = await GET(cronRequest("Bearer wrong-secret"));

  expect(res.status).toBe(401);
  expect(mockRefreshCalendarCache).not.toHaveBeenCalled();
});

test("GET /api/cron/fetch-calendar returns 401 and calls nothing for a malformed header (no Bearer scheme)", async () => {
  const res = await GET(cronRequest("test-cron-secret"));

  expect(res.status).toBe(401);
  expect(mockRefreshCalendarCache).not.toHaveBeenCalled();
});

test("GET /api/cron/fetch-calendar calls refreshCalendarCache and returns its result as JSON with a valid secret", async () => {
  mockRefreshCalendarCache.mockResolvedValue({ cached: 3 });

  const res = await GET(cronRequest("Bearer test-cron-secret"));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ cached: 3 });
  expect(mockRefreshCalendarCache).toHaveBeenCalledTimes(1);
});
