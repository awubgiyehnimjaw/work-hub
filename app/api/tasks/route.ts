import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, tasks } from "@/lib/db/schema";
import { isTaskStale } from "@/lib/tasks/aging";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Open work (default, and also explicit `?status=active`): active tasks
 * that aren't currently snoozed into the future. A `snoozedUntil` that has
 * already elapsed no longer excludes the row — it reappears on the very
 * next call, same as an unsnoozed task.
 *
 * `?status=completed` (added for Task 14's history page) drops the
 * active-only/snooze filter entirely — a completed task is done regardless
 * of any leftover `snoozedUntil` — and returns everything with
 * `status = 'completed'` instead.
 *
 * `?clientId=<uuid>` (either status) further restricts to that one
 * client's tasks.
 *
 * Every row is left-joined against `clients` and annotated with
 * `clientName` (the client's `displayName`, or `null` for a task with no
 * client — e.g. a `todo`) — the history page groups by this without a
 * second request.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const clientIdParam = url.searchParams.get("clientId");

  if (statusParam !== null && statusParam !== "active" && statusParam !== "completed") {
    return NextResponse.json(
      { error: "status must be 'active' or 'completed'" },
      { status: 400 },
    );
  }
  if (clientIdParam !== null && !UUID_RE.test(clientIdParam)) {
    return NextResponse.json(
      { error: "clientId must be a valid UUID" },
      { status: 400 },
    );
  }

  const now = new Date();
  const status = statusParam ?? "active";

  // Exactly Task 11's original where-clause when status is (or defaults
  // to) "active" — preserved verbatim rather than reshaped, so the
  // dashboard's existing behavior can't drift.
  const statusFilter =
    status === "active"
      ? and(
          eq(tasks.status, "active"),
          or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now)),
        )
      : eq(tasks.status, "completed");

  const where = clientIdParam
    ? and(statusFilter, eq(tasks.clientId, clientIdParam))
    : statusFilter;

  const rows = await db
    .select({ task: tasks, clientName: clients.displayName })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(where)
    .orderBy(asc(tasks.createdAt));

  const annotated = rows.map(({ task, clientName }) => ({
    ...task,
    isStale: isTaskStale(task, now),
    clientName: clientName ?? null,
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
