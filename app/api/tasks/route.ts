import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { isTaskStale } from "@/lib/tasks/aging";

/**
 * All open work: active tasks that aren't currently snoozed into the
 * future. A `snoozedUntil` that has already elapsed no longer excludes
 * the row — it reappears on the very next call, same as an unsnoozed
 * task. Sorted oldest-first so the longest-waiting item leads the list,
 * and each row carries a computed `isStale` flag for the UI to flag.
 */
export async function GET() {
  const now = new Date();

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "active"),
        or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now)),
      ),
    )
    .orderBy(asc(tasks.createdAt));

  const annotated = rows.map((task) => ({
    ...task,
    isStale: isTaskStale(task, now),
  }));

  return NextResponse.json(annotated);
}

interface QuickAddPayload {
  title: string;
}

function parseQuickAddPayload(body: unknown): QuickAddPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { title } = body as Record<string, unknown>;
  if (typeof title !== "string" || title.trim().length === 0) {
    return null;
  }
  return { title };
}

/**
 * Quick-add for Callum's own loose to-dos — always `type: 'todo'`. Review
 * tasks (`type: 'review'`) are only ever created by Task 6's Frame.io
 * poller, never through this endpoint.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const payload = parseQuickAddPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must be { title: string }" },
      { status: 400 },
    );
  }

  const [task] = await db
    .insert(tasks)
    .values({ type: "todo", title: payload.title, status: "active" })
    .returning();

  return NextResponse.json(task, { status: 201 });
}
