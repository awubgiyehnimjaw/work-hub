import { NextResponse, type NextRequest } from "next/server";
import { checkCronSecret } from "@/lib/auth/cron-secret";
import { checkDueTodos, maybeSendPostingScheduleDigest, maybeSendWeeklyDigest } from "@/lib/reminders/check";

// Mirrors the other two cron routes' maxDuration — see
// app/api/cron/poll-frameio/route.ts.
export const maxDuration = 60;

// Called by an external scheduler (GitHub Actions), not Callum's browser —
// same bearer-secret auth as the other two cron routes, checked before any
// DB or push-service call. Handles three unrelated-but-all-lightweight
// checks in one route rather than separate cron entries: due to-dos (every
// run), the weekly digest (a no-op outside its Sunday window), and the
// posting-schedule digest (a no-op outside its daily morning window).
export async function GET(request: NextRequest) {
  if (!checkCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dueTodos = await checkDueTodos(now);
  const digest = await maybeSendWeeklyDigest(now);
  const postingSchedule = await maybeSendPostingScheduleDigest(now);

  return NextResponse.json(
    { todosNotified: dueTodos.notified, digestSent: digest.sent, postingScheduleSent: postingSchedule.sent },
    { status: 200 },
  );
}
