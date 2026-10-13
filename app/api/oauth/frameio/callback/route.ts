import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { oauthTokens } from "@/lib/db/schema";
import { exchangeFrameioCode } from "@/lib/frameio/oauth";

// Adobe redirects here with `?code=...` after Callum approves the consent
// screen from /api/oauth/frameio/start. Also behind the passcode session.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json(
      { error: "Missing code query parameter" },
      { status: 400 },
    );
  }

  // Must exactly match the redirect_uri built in the /start route for this
  // same flow — Adobe's token endpoint validates the two agree.
  const redirectUri = new URL(
    "/api/oauth/frameio/callback",
    request.nextUrl.origin,
  ).toString();

  const { accessToken, refreshToken, expiresAt } = await exchangeFrameioCode(
    code,
    redirectUri,
  );

  // Upsert keyed on the `oauth_tokens.provider` unique constraint (Task 2)
  // — this route can be revisited to reconnect/refresh the stored token,
  // so a stale row must be overwritten, not skipped.
  await db
    .insert(oauthTokens)
    .values({ provider: "frameio", accessToken, refreshToken, expiresAt })
    .onConflictDoUpdate({
      target: oauthTokens.provider,
      set: { accessToken, refreshToken, expiresAt },
    });

  return NextResponse.json({ status: "connected", provider: "frameio" });
}
