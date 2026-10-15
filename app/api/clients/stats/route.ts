import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, tasks } from "@/lib/db/schema";
import { computeClientStats } from "@/lib/clients/stats";

/**
 * Per-client review volume and turnaround for the overview section of
 * `/clients` — computed in application code (`computeClientStats`) rather
 * than a SQL aggregate, since the task volume here is small enough that a
 * plain fetch-then-reduce is simpler and just as fast, and it keeps the
 * aggregation itself unit-testable without a database.
 */
export async function GET() {
  const clientRows = await db.select().from(clients);
  const reviewTasks = await db
    .select({
      clientId: tasks.clientId,
      status: tasks.status,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(eq(tasks.type, "review"));

  const stats = computeClientStats(clientRows, reviewTasks).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  return NextResponse.json(stats);
}
