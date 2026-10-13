import { NextResponse, type NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/auth/cron-secret";
import { refreshCalendarCache } from "@/lib/calendar/fetch";

// Called by an external scheduler (GitHub Actions), not Callum's browser —
// auth is the CRON_SECRET bearer token, not the passcode session, and this
// path is explicitly allowlisted past that cookie check in middleware.ts.
// The secret check must happen before any DB or Google Calendar API call:
// an unauthenticated caller gets a 401 with zero side effects, not even a
// read. Mirrors /api/cron/poll-frameio/route.ts (Task 6) exactly.
export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await refreshCalendarCache();
  return NextResponse.json(result, { status: 200 });
}
