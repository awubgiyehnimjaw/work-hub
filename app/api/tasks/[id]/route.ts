import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

type PatchBody =
  | { action: "complete" }
  | { action: "snooze"; until: Date };

function parsePatchBody(body: unknown): PatchBody | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { action } = body as Record<string, unknown>;

  if (action === "complete") {
    return { action: "complete" };
  }

  if (action === "snooze") {
    const { until } = body as Record<string, unknown>;
    if (typeof until !== "string") {
      return null;
    }
    const parsedUntil = new Date(until);
    if (Number.isNaN(parsedUntil.getTime())) {
      return null;
    }
    return { action: "snooze", until: parsedUntil };
  }

  return null;
}

/**
 * Completes or snoozes a single task (either a `review` or a `todo` —
 * the action doesn't care which). A past `until` is accepted as-is: that's
 * exactly how a snoozed task is made to reappear immediately on the next
 * `GET /api/tasks` call, per `isTaskStale`'s "snoozedUntil <= now" rule.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const body: unknown = await request.json().catch(() => null);
  const parsed = parsePatchBody(body);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "Body must be { action: 'complete' } or { action: 'snooze', until: <ISO string> }",
      },
      { status: 400 },
    );
  }

  const updateValues =
    parsed.action === "complete"
      ? { status: "completed" as const, completedAt: new Date() }
      : { snoozedUntil: parsed.until };

  const [updated] = await db
    .update(tasks)
    .set(updateValues)
    .where(eq(tasks.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(updated, { status: 200 });
}
