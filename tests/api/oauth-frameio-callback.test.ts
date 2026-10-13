import { NextRequest } from "next/server";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { GET } from "@/app/api/oauth/frameio/callback/route";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";

beforeAll(() => {
  process.env.FRAMEIO_CLIENT_ID = "test-client-id";
  process.env.FRAMEIO_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockTokenResponse(accessToken: string, refreshToken: string) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
}

// Real NextRequest, constructed directly (no running server) — same
// approach tests/middleware.test.ts uses for the route handlers' sibling,
// `middleware.ts`, verified to work fine outside an actual server.
function callbackRequest(code?: string): NextRequest {
  const url = new URL(
    "/api/oauth/frameio/callback",
    "http://localhost",
  );
  if (code !== undefined) {
    url.searchParams.set("code", code);
  }
  return new NextRequest(url);
}

async function frameioTokenRows() {
  return (await db.select().from(oauthTokens)).filter(
    (row) => row.provider === "frameio",
  );
}

test("GET /api/oauth/frameio/callback exchanges the code, inserts a new oauthTokens row for 'frameio', and upserts (updates, not duplicates) that same row on a later reconnect", async () => {
  vi.stubGlobal("fetch", mockTokenResponse("access-1", "refresh-1"));
  const firstRes = await GET(callbackRequest("code-1"));
  expect(firstRes.status).toBe(200);

  let frameioRows = await frameioTokenRows();
  expect(frameioRows).toHaveLength(1);
  expect(frameioRows[0].accessToken).toBe("access-1");
  expect(frameioRows[0].refreshToken).toBe("refresh-1");

  // Revisiting the connect flow (reconnect) must update the single
  // provider='frameio' row via the unique constraint, not insert a second.
  vi.stubGlobal("fetch", mockTokenResponse("access-2", "refresh-2"));
  const secondRes = await GET(callbackRequest("code-2"));
  expect(secondRes.status).toBe(200);

  frameioRows = await frameioTokenRows();
  expect(frameioRows).toHaveLength(1);
  expect(frameioRows[0].accessToken).toBe("access-2");
  expect(frameioRows[0].refreshToken).toBe("refresh-2");
});

test("GET /api/oauth/frameio/callback returns 400 and touches neither fetch nor the DB when code is missing", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const res = await GET(callbackRequest());

  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
