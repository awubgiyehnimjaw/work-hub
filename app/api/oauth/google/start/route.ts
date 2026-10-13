import { NextResponse, type NextRequest } from "next/server";
import { buildGoogleAuthorizeUrl } from "@/lib/calendar/oauth";

// Visited manually once by Callum (already behind the passcode session via
// middleware.ts) to kick off the Google Calendar connect flow. The
// redirect_uri is derived from the incoming request's own origin rather
// than a dedicated base-URL env var — none exists yet in this project
// (same approach as /api/oauth/frameio/start, Task 5) — which keeps this
// route correct in both local dev and whatever origin Vercel serves it
// from, as long as /start and /callback are always reached via the same
// origin (true for a single-user app Callum visits directly).
export function GET(request: NextRequest) {
  const redirectUri = new URL(
    "/api/oauth/google/callback",
    request.nextUrl.origin,
  ).toString();

  return NextResponse.redirect(buildGoogleAuthorizeUrl(redirectUri));
}
