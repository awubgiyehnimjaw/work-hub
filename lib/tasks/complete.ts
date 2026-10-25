import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, tasks } from "@/lib/db/schema";

/**
 * Completes a task (review or todo) and, for a review task with a client
 * attached, bumps that client's `lastActivityAt` — the exact logic
 * `PATCH /api/tasks/[id]`'s `action: "complete"` case uses, extracted so
 * the Telegram chat tools' "mark done" actions reuse it rather than
 * re-deriving it. Returns `null` if no task with that id exists.
 */
export async function completeTask(id: string, now: Date): Promise<typeof tasks.$inferSelect | null> {
  const [updated] = await db
    .update(tasks)
    .set({ status: "completed", completedAt: now })
    .where(eq(tasks.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  if (updated.type === "review" && updated.clientId !== null) {
    await db
      .update(clients)
      .set({ lastActivityAt: now })
      .where(eq(clients.id, updated.clientId));
  }

  return updated;
}
