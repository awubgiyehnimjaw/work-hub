import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

/** Sets `snoozedUntil` only — never touches `dueAt`. Returns `null` if no task with that id exists. */
export async function snoozeTask(id: string, until: Date): Promise<typeof tasks.$inferSelect | null> {
  const [updated] = await db
    .update(tasks)
    .set({ snoozedUntil: until })
    .where(eq(tasks.id, id))
    .returning();

  return updated ?? null;
}
