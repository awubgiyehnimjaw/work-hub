import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";

/**
 * Records a posting-schedule sheet row as done — the exact logic
 * `POST /api/posting-schedule/complete` uses, extracted so the Telegram
 * chat tools' "mark done" action reuses it. `onConflictDoNothing` makes
 * calling this twice for the same entry a no-op instead of an error.
 */
export async function completePostingScheduleEntry(entryKey: string): Promise<void> {
  await db.insert(postingScheduleCompletions).values({ entryKey }).onConflictDoNothing();
}
