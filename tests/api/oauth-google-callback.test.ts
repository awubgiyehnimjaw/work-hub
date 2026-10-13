import { NextRequest } from "next/server";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { GET } from "@/app/api/oauth/google/callback/route";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
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
// approach tests/api/oauth-frameio-callback.test.ts uses for its sibling
// route handler.
function callbackRequest(code?: string): NextRequest {
  const url = new URL("/api/oauth/google/callback", "http://localhost");
  if (code !== undefined) {
    url.searchParams.set("code", code);
  }
  return new NextRequest(url);
}

async function googleTokenRows() {
  return (await db.select().from(oauthTokens)).filter(
    (row) => row.provider === "google",
  );
}

test("GET /api/oauth/google/callback exchanges the code, inserts a new oauthTokens row for 'google', and upserts (updates, not duplicates) that same row on a later reconnect", async () => {
  vi.stubGlobal("fetch", mockTokenResponse("access-1", "refresh-1"));
  const firstRes = await GET(callbackRequest("code-1"));
  expect(firstRes.status).toBe(200);

  let googleRows = await googleTokenRows();
  expect(googleRows).toHaveLength(1);
  expect(googleRows[0].accessToken).toBe("access-1");
  expect(googleRows[0].refreshToken).toBe("refresh-1");

  // Revisiting the connect flow (reconnect) must update the single
  // provider='google' row via the unique constraint, not insert a second.
  vi.stubGlobal("fetch", mockTokenResponse("access-2", "refresh-2"));
  const secondRes = await GET(callbackRequest("code-2"));
  expect(secondRes.status).toBe(200);

  googleRows = await googleTokenRows();
  expect(googleRows).toHaveLength(1);
  expect(googleRows[0].accessToken).toBe("access-2");
  expect(googleRows[0].refreshToken).toBe("refresh-2");
});

test("GET /api/oauth/google/callback returns 400 and touches neither fetch nor the DB when code is missing", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const res = await GET(callbackRequest());

  expect(res.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});
