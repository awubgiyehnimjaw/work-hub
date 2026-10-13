import { NextResponse, type NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/auth/cron-secret";
import { runFrameioPoll } from "@/lib/frameio/poll";

// Important 3: a full folder traversal can issue up to ~1,000 requests, so
// this needs more headroom than a typical route before Vercel's platform
// timeout kills the function mid-run. 60s is comfortably inside the Vercel
// Hobby/Pro plan's max for a route that sets this explicitly.
export const maxDuration = 60;

// Called by an external scheduler (GitHub Actions), not Callum's browser —
// auth is the CRON_SECRET bearer token, not the passcode session, and this
// path is explicitly allowlisted past that cookie check in middleware.ts.
// The secret check must happen before any DB or Frame.io API call: an
// unauthenticated caller gets a 401 with zero side effects, not even a read.
export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runFrameioPoll();
  // Important 3: runFrameioPoll isolates a listNewFiles failure (Frame.io
  // 429/5xx, network error, etc.) into `{ failed: true }` instead of
  // throwing — surface that as a clean 502 rather than letting it either
  // silently look like success (200) or crash into an unhandled 500.
  return NextResponse.json(result, { status: result.failed ? 502 : 200 });
}
