import { NextResponse, type NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/auth/cron-secret";
import { checkDueTodos, maybeSendWeeklyDigest } from "@/lib/reminders/check";

// Mirrors the other two cron routes' maxDuration — see
// app/api/cron/poll-frameio/route.ts.
export const maxDuration = 60;

// Called by an external scheduler (GitHub Actions), not Callum's browser —
// same bearer-secret auth as the other two cron routes, checked before any
// DB or push-service call. Handles two unrelated-but-both-lightweight
// checks in one route rather than two separate cron entries: due to-dos
// (every run) and the weekly digest (a no-op outside its Sunday window).
export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dueTodos = await checkDueTodos(now);
  const digest = await maybeSendWeeklyDigest(now);

  return NextResponse.json(
    { todosNotified: dueTodos.notified, digestSent: digest.sent },
    { status: 200 },
  );
}
