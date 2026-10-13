import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { exchangeGoogleCode } from "@/lib/calendar/oauth";

// Google redirects here with `?code=...` after Callum approves the
// consent screen from /api/oauth/google/start. Also behind the passcode
// session.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json(
      { error: "Missing code query parameter" },
      { status: 400 },
    );
  }

  // Must exactly match the redirect_uri built in the /start route for this
  // same flow — Google's token endpoint validates the two agree.
  const redirectUri = new URL(
    "/api/oauth/google/callback",
    request.nextUrl.origin,
  ).toString();

  const { accessToken, refreshToken, expiresAt } = await exchangeGoogleCode(
    code,
    redirectUri,
  );

  // Upsert keyed on the `oauth_tokens.provider` unique constraint (Task 2)
  // — this route can be revisited to reconnect/refresh the stored token,
  // so a stale row must be overwritten, not skipped. Same pattern as
  // /api/oauth/frameio/callback (Task 5).
  await db
    .insert(oauthTokens)
    .values({ provider: "google", accessToken, refreshToken, expiresAt })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: { accessToken, refreshToken, expiresAt },
    });

  return NextResponse.json({ status: "connected", provider: "google" });
}
