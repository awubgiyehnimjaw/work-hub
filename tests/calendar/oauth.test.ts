import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  refreshGoogleToken,
} from "@/lib/calendar/oauth";

const REDIRECT_URI = "https://work-hub.example.com/api/oauth/google/callback";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

beforeEach(async () => {
  await db.delete(oauthTokens);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("exchangeGoogleCode posts the correct grant_type/params to Google's token endpoint and parses the response", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "access-token-123",
        refresh_token: "refresh-token-456",
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const before = Date.now();
  const result = await exchangeGoogleCode("auth-code-abc", REDIRECT_URI);
  const after = Date.now();

  // Hit the real Google token endpoint with a POST, not a stand-in.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://oauth2.googleapis.com/token");
  expect(init.method).toBe("POST");

  // Body must carry exactly the params Google's token endpoint requires.
  const sentBody = new URLSearchParams(init.body as string);
  expect(sentBody.get("client_id")).toBe("test-client-id");
  expect(sentBody.get("client_secret")).toBe("test-client-secret");
  expect(sentBody.get("code")).toBe("auth-code-abc");
  expect(sentBody.get("grant_type")).toBe("authorization_code");
  expect(sentBody.get("redirect_uri")).toBe(REDIRECT_URI);

  // Response fields are parsed into the documented shape.
  expect(result.accessToken).toBe("access-token-123");
  expect(result.refreshToken).toBe("refresh-token-456");
  expect(result.expiresAt).toBeInstanceOf(Date);
  expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
  expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000);
});

test("exchangeGoogleCode throws when the token endpoint responds with an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      }),
    ),
  );

  await expect(exchangeGoogleCode("bad-code", REDIRECT_URI)).rejects.toThrow();
});

test("buildGoogleAuthorizeUrl builds Google's authorize URL with client id, redirect uri, response type, calendar read-only scope, access_type=offline, and prompt=consent", () => {
  const url = buildGoogleAuthorizeUrl(REDIRECT_URI);
  const parsed = new URL(url);

  expect(parsed.origin + parsed.pathname).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
  expect(parsed.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
  expect(parsed.searchParams.get("response_type")).toBe("code");
  expect(parsed.searchParams.get("scope")).toBe(
    "https://www.googleapis.com/auth/calendar.readonly",
  );
  // access_type=offline is required to receive a refresh token at all, and
  // prompt=consent guarantees one even if Callum has connected before —
  // this is a one-time setup flow, so losing the refresh token on a
  // reconnect would be painful to recover from.
  expect(parsed.searchParams.get("access_type")).toBe("offline");
  expect(parsed.searchParams.get("prompt")).toBe("consent");
});

test("refreshGoogleToken posts grant_type=refresh_token with the stored refresh token, and updates the stored row", async () => {
  await db.insert(oauthTokens).values({
    provider: "google",
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
    expiresAt: new Date(Date.now() - 1000), // already expired
  });

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);

  const before = Date.now();
  await refreshGoogleToken();
  const after = Date.now();

  // Hits the same Google token endpoint, with the refresh_token grant.
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://oauth2.googleapis.com/token");
  expect(init.method).toBe("POST");

  const sentBody = new URLSearchParams(init.body as string);
  expect(sentBody.get("client_id")).toBe("test-client-id");
  expect(sentBody.get("client_secret")).toBe("test-client-secret");
  expect(sentBody.get("grant_type")).toBe("refresh_token");
  expect(sentBody.get("refresh_token")).toBe("old-refresh-token");

  // The stored row is overwritten with the refreshed token pair.
  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"));
  expect(row.accessToken).toBe("new-access-token");
  expect(row.refreshToken).toBe("new-refresh-token");
  expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
  expect(row.expiresAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000);
});

test("refreshGoogleToken keeps the existing refresh token when Google doesn't return a new one", async () => {
  // Google's refresh response commonly omits refresh_token (the original
  // stays valid) — this must not wipe out the stored refresh token.
  await db.insert(oauthTokens).values({
    provider: "google",
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
    expiresAt: new Date(Date.now() - 1000),
  });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "new-access-token", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );

  await refreshGoogleToken();

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"));
  expect(row.accessToken).toBe("new-access-token");
  expect(row.refreshToken).toBe("old-refresh-token");
});

test("refreshGoogleToken throws when there is no stored oauthTokens row for google (nothing to refresh)", async () => {
  vi.stubGlobal("fetch", vi.fn());

  await expect(refreshGoogleToken()).rejects.toThrow(/not connected|nothing to refresh/i);
});

test("refreshGoogleToken throws when the token endpoint responds with an error, leaving the stored row untouched", async () => {
  await db.insert(oauthTokens).values({
    provider: "google",
    accessToken: "old-access-token",
    refreshToken: "old-refresh-token",
    expiresAt: new Date(Date.now() - 1000),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    ),
  );

  await expect(refreshGoogleToken()).rejects.toThrow();

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"));
  expect(row.accessToken).toBe("old-access-token");
});
