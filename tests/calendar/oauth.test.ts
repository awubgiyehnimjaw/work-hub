import { afterEach, beforeAll, expect, test, vi } from "vitest";
import {
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
} from "@/lib/calendar/oauth";

const REDIRECT_URI = "https://work-hub.example.com/api/oauth/google/callback";

beforeAll(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
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
