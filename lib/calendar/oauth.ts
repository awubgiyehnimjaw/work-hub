/**
 * Google OAuth 2.0 for read-only Calendar access (member-level connect, the
 * Google-side mirror of `lib/frameio/oauth.ts`). Callum visits
 * `/api/oauth/google/start` once during setup, Google redirects back to
 * `/api/oauth/google/callback?code=...`, and this module exchanges that
 * code for a token pair stored in `oauthTokens`.
 *
 * Endpoints and required params below are Google's documented, stable
 * OAuth 2.0 endpoints (not guessed):
 * - https://accounts.google.com/o/oauth2/v2/auth
 * - https://oauth2.googleapis.com/token
 *
 * Google access tokens are short-lived (~1 hour), same as Frame.io's — so
 * this module also owns `refreshGoogleToken`, which uses the stored
 * `refreshToken` to mint a new access token against the same token
 * endpoint. Called from `lib/calendar/google-client.ts` whenever the stored
 * token is at/near expiry, following the exact same pattern as
 * `lib/frameio/client.ts`'s `getAccessToken` calling `refreshFrameioToken`
 * (Task 6's review flagged a missing refresh path as a real gap there, so
 * it's addressed here from the start rather than in a later fix round).
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";

const GOOGLE_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

function requireEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

/**
 * Builds the Google authorize URL Callum is redirected to from
 * `/api/oauth/google/start`. `redirectUri` must be the exact URL Google
 * will redirect back to — it is echoed into the token exchange and
 * Google rejects a mismatch.
 *
 * Google only returns a `refresh_token` on the authorize request when
 * `access_type=offline` is included, and only guarantees one on the first
 * consent unless `prompt=consent` is also included. Since this is a
 * one-time setup flow and losing the refresh token would mean Callum has
 * to manually reconnect, both are included so a refresh token comes back
 * every time he visits `/start`, not just the first time.
 */
export function buildGoogleAuthorizeUrl(redirectUri: string): string {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");

  const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds until the access token expires (Google convention). */
  expires_in: number;
}

/**
 * Google's refresh response always carries a fresh access token, but often
 * omits `refresh_token` (the original stays valid, Google just doesn't
 * rotate it on every refresh) — so it's optional here, unlike the initial
 * exchange where it's guaranteed. Same shape as Adobe's
 * `AdobeRefreshResponse` in `lib/frameio/oauth.ts`.
 */
interface GoogleRefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToGoogleTokenEndpoint<T>(
  params: Record<string, string>,
  failureLabel: string,
): Promise<T> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`${failureLabel}: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as T;
}

/**
 * Exchanges the authorization `code` Google sent to the callback route for
 * an access/refresh token pair.
 *
 * `redirectUri` must be the exact same URL that was passed to
 * `buildGoogleAuthorizeUrl` for this flow — Google's token endpoint
 * validates it matches the `redirect_uri` used at the authorize endpoint
 * (RFC 6749), same constraint as Frame.io's flow (Task 5).
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  const data = await postToGoogleTokenEndpoint<GoogleTokenResponse>(
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    "Google token exchange failed",
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Uses the stored `refreshToken` for the `google` `oauthTokens` row to mint
 * a new access token from Google's token endpoint, and overwrites that row
 * with the refreshed access/refresh token pair and expiry. Throws if there
 * is no stored row to refresh (Google was never connected) — there is
 * nothing useful to do in that case, the caller should direct Callum
 * through the connect flow instead. Mirrors
 * `lib/frameio/oauth.ts`'s `refreshFrameioToken` exactly.
 */
export async function refreshGoogleToken(): Promise<void> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "google"));
  if (!row) {
    throw new Error(
      "Google is not connected (no oauthTokens row for provider 'google') — nothing to refresh",
    );
  }

  const data = await postToGoogleTokenEndpoint<GoogleRefreshResponse>(
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
    },
    "Google token refresh failed",
  );

  const accessToken = data.access_token;
  // Google may not return a new refresh token on every refresh; keep the
  // existing one in that case rather than discarding it.
  const refreshToken = data.refresh_token ?? row.refreshToken;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  // Same upsert pattern as the callback route's initial connect (Task 9) —
  // keyed on the `oauth_tokens.provider` unique constraint.
  await db
    .insert(oauthTokens)
    .values({ provider: "google", accessToken, refreshToken, expiresAt })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: { accessToken, refreshToken, expiresAt },
    });
}
