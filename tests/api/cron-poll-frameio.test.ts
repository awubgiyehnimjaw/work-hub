import { NextRequest } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";
import { GET, maxDuration } from "@/app/api/cron/poll-frameio/route";
import { runFrameioPoll } from "@/lib/frameio/poll";

// Mocked so this test can assert the auth gate runs before ANY side
// effect (DB reads/writes, Frame.io API calls) — runFrameioPoll is the
// sole place those happen, so "was it called at all" is the right proxy
// for "did any side effect happen".
vi.mock("@/lib/frameio/poll", () => ({
  runFrameioPoll: vi.fn(),
}));

const mockRunFrameioPoll = runFrameioPoll as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.CRON_SECRET = "test-cron-secret";
  mockRunFrameioPoll.mockReset();
});

function cronRequest(authorizationHeader?: string): NextRequest {
  const headers: HeadersInit = {};
  if (authorizationHeader !== undefined) {
    headers["authorization"] = authorizationHeader;
  }
  return new NextRequest(new URL("/api/cron/poll-frameio", "http://localhost"), {
    headers,
  });
}

test("GET /api/cron/poll-frameio returns 401 and calls nothing without a valid secret", async () => {
  const res = await GET(cronRequest());

  expect(res.status).toBe(401);
  expect(mockRunFrameioPoll).not.toHaveBeenCalled();
});

test("GET /api/cron/poll-frameio returns 401 and calls nothing for a wrong bearer token", async () => {
  const res = await GET(cronRequest("Bearer wrong-secret"));

  expect(res.status).toBe(401);
  expect(mockRunFrameioPoll).not.toHaveBeenCalled();
});

test("GET /api/cron/poll-frameio returns 401 and calls nothing for a malformed header (no Bearer scheme)", async () => {
  const res = await GET(cronRequest("test-cron-secret"));

  expect(res.status).toBe(401);
  expect(mockRunFrameioPoll).not.toHaveBeenCalled();
});

test("GET /api/cron/poll-frameio calls runFrameioPoll and returns its result as JSON with a valid secret", async () => {
  mockRunFrameioPoll.mockResolvedValue({ created: 2, unrecognized: 1 });

  const res = await GET(cronRequest("Bearer test-cron-secret"));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ created: 2, unrecognized: 1 });
  expect(mockRunFrameioPoll).toHaveBeenCalledTimes(1);
});

// I3 regression coverage: when runFrameioPoll reports an isolated
// listNewFiles failure (`failed: true`), the route must surface that as a
// clean error response rather than a 200 that looks like success.
test("GET /api/cron/poll-frameio returns 502 when runFrameioPoll reports a failed run", async () => {
  mockRunFrameioPoll.mockResolvedValue({ created: 0, unrecognized: 0, failed: true });

  const res = await GET(cronRequest("Bearer test-cron-secret"));

  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ created: 0, unrecognized: 0, failed: true });
});

// I3 regression coverage: the route must declare enough headroom for a
// full folder traversal (up to ~1,000 requests) to avoid Vercel's default
// function timeout killing it mid-run.
test("exports maxDuration = 60 for Vercel", () => {
  expect(maxDuration).toBe(60);
});
