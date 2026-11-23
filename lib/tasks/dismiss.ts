import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

/** Archives a task via `status: "dismissed"` — never a hard delete. Returns `null` if no task with that id exists. */
export async function dismissTask(id: string): Promise<typeof tasks.$inferSelect | null> {
  const [updated] = await db
    .update(tasks)
    .set({ status: "dismissed" })
    .where(eq(tasks.id, id))
    .returning();

  return updated ?? null;
}
