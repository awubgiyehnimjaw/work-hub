/**
 * Adobe IMS OAuth for Frame.io (member-level connect, not an admin/webhook
 * setup). Callum is a regular project member on his editor's Frame.io
 * account, so this is the standard three-legged OAuth code flow:
 * `/api/oauth/frameio/start` sends him to Adobe's consent screen, Adobe
 * redirects back to `/api/oauth/frameio/callback?code=...`, and this module
 * exchanges that code for a token pair stored in `oauthTokens`.
 *
 * Endpoints and required params below are Adobe IMS's documented v2/v3
 * endpoints for Frame.io (not guessed):
 * - https://ims-na1.adobelogin.com/ims/authorize/v2
 * - https://ims-na1.adobelogin.com/ims/token/v3
 *
 * Adobe access tokens are short-lived (~1 hour), so this module also owns
 * `refreshFrameioToken`, which uses the stored `refreshToken` to mint a new
 * access token against the same token endpoint — called from
 * `lib/frameio/client.ts` whenever the stored token is at/near expiry, so a
 * poll run never silently starts failing with 401s once the initial connect
 * is more than an hour old.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";

const ADOBE_AUTHORIZE_ENDPOINT = "https://ims-na1.adobelogin.com/ims/authorize/v2";
const ADOBE_TOKEN_ENDPOINT = "https://ims-na1.adobelogin.com/ims/token/v3";

// `offline_access` is required to receive a refresh token at all — without
// it there is nothing to store in `oauthTokens.refreshToken`, and the
// connection would silently stop working once the ~1 hour access token
// expires.
const FRAMEIO_SCOPES = "openid email profile offline_access additional_info.roles";

function requireEnv(name: "FRAMEIO_CLIENT_ID" | "FRAMEIO_CLIENT_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

/**
 * Builds the Adobe IMS authorize URL Callum is redirected to from
 * `/api/oauth/frameio/start`. `redirectUri` must be the exact URL Adobe will
 * redirect back to — it is echoed into the token exchange and Adobe
 * rejects a mismatch.
 */
export function buildFrameioAuthorizeUrl(redirectUri: string): string {
  const clientId = requireEnv("FRAMEIO_CLIENT_ID");

  const url = new URL(ADOBE_AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", FRAMEIO_SCOPES);
  return url.toString();
}

interface AdobeTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds until the access token expires (Adobe IMS convention). */
  expires_in: number;
}

/**
 * Adobe's refresh response always carries a fresh access token, but may or
 * may not rotate the refresh token itself (depends on the IMS client's
 * configuration) — so `refresh_token` is optional here, unlike the initial
 * exchange where it's guaranteed.
 */
interface AdobeRefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToAdobeTokenEndpoint<T>(
  params: Record<string, string>,
  failureLabel: string,
): Promise<T> {
  const response = await fetch(ADOBE_TOKEN_ENDPOINT, {
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
 * Exchanges the authorization `code` Adobe sent to the callback route for
 * an access/refresh token pair.
 *
 * `redirectUri` must be the exact same URL that was passed to
 * `buildFrameioAuthorizeUrl` for this flow — Adobe's token endpoint
 * validates it matches the `redirect_uri` used at `/authorize/v2`.
 */
export async function exchangeFrameioCode(
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const clientId = requireEnv("FRAMEIO_CLIENT_ID");
  const clientSecret = requireEnv("FRAMEIO_CLIENT_SECRET");

  const data = await postToAdobeTokenEndpoint<AdobeTokenResponse>(
    {
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    },
    "Frame.io token exchange failed",
  );

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Uses the stored `refreshToken` for the `frameio` `oauthTokens` row to
 * mint a new access token from Adobe IMS, and overwrites that row with the
 * refreshed access/refresh token pair and expiry. Throws if there is no
 * stored row to refresh (Frame.io was never connected) — there is nothing
 * useful to do in that case, the caller should direct Callum through the
 * connect flow instead.
 */
export async function refreshFrameioToken(): Promise<void> {
  const clientId = requireEnv("FRAMEIO_CLIENT_ID");
  const clientSecret = requireEnv("FRAMEIO_CLIENT_SECRET");

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, "frameio"));
  if (!row) {
    throw new Error(
      "Frame.io is not connected (no oauthTokens row for provider 'frameio') — nothing to refresh",
    );
  }

  const data = await postToAdobeTokenEndpoint<AdobeRefreshResponse>(
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
    },
    "Frame.io token refresh failed",
  );

  const accessToken = data.access_token;
  // Adobe may not return a new refresh token on every refresh; keep the
  // existing one in that case rather than discarding it.
  const refreshToken = data.refresh_token ?? row.refreshToken;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  // Same upsert pattern as the callback route's initial connect (Task 5) —
  // keyed on the `oauth_tokens.provider` unique constraint.
  await db
    .insert(oauthTokens)
    .values({ provider: "frameio", accessToken, refreshToken, expiresAt })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: { accessToken, refreshToken, expiresAt },
    });
}
