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
 */

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

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(ADOBE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Frame.io token exchange failed: ${response.status} ${errorBody}`,
    );
  }

  const data = (await response.json()) as AdobeTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}
