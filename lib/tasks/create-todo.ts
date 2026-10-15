import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

export interface CreateTodoInput {
  title: string;
  dueAt: Date | null;
}

/** Shared by `POST /api/tasks` and the Telegram webhook — the only two places a to-do gets created. */
export async function createTodo(input: CreateTodoInput): Promise<typeof tasks.$inferSelect> {
  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: input.title, status: "active", dueAt: input.dueAt })
    .returning();
  return task;
}
