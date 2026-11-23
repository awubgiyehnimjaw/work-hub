import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

/**
 * Archives a task via `status: "dismissed"` — never a hard delete.
 * Scoped to `status: "active"` so a stale Drop press on a task already
 * completed elsewhere is a no-op rather than overwriting its status —
 * returns `null` the same as an unknown id.
 */
export async function dismissTask(id: string): Promise<typeof tasks.$inferSelect | null> {
  const [updated] = await db
    .update(tasks)
    .set({ status: "dismissed" })
    .where(and(eq(tasks.id, id), eq(tasks.status, "active")))
    .returning();

  return updated ?? null;
}
