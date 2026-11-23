import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

/**
 * Sets `snoozedUntil` — never touches `dueAt` — and clears
 * `telegramNagSentAt`. The clear matters because this is the only way a
 * to-do's nag cadence changes (its only callers are the nag/sweep
 * Snooze-1h and Tomorrow buttons): without it, the next nag would still
 * wait out the original 3-hour-since-last-nag window regardless of how
 * short a snooze was requested, making "Snooze 1h" behave exactly like
 * ignoring the nag. Scoped to `status: "active"` so a stale button press
 * on a task already completed/dismissed/re-snoozed elsewhere is a no-op
 * rather than silently reviving it — returns `null` the same as an
 * unknown id (final-review Important: a stale press previously still
 * "succeeded").
 */
export async function snoozeTask(id: string, until: Date): Promise<typeof tasks.$inferSelect | null> {
  const [updated] = await db
    .update(tasks)
    .set({ snoozedUntil: until, telegramNagSentAt: null })
    .where(and(eq(tasks.id, id), eq(tasks.status, "active")))
    .returning();

  return updated ?? null;
}
