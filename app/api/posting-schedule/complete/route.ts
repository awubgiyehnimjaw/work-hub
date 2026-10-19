import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { postingScheduleCompletions } from "@/lib/db/schema";

/**
 * Marks a posting-schedule sheet row as done — the "Done" button on the
 * dashboard card. The sheet itself is never written to (read-only CSV
 * export); this just records the entry's key in our own DB so
 * `GET /api/posting-schedule/due-soon` and the daily push digest both stop
 * showing it. `onConflictDoNothing` makes pressing Done twice a no-op
 * instead of an error.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const entryKey = typeof body === "object" && body !== null ? (body as Record<string, unknown>).entryKey : undefined;

  if (typeof entryKey !== "string" || entryKey.length === 0) {
    return NextResponse.json({ error: "entryKey must be a non-empty string" }, { status: 400 });
  }

  await db.insert(postingScheduleCompletions).values({ entryKey }).onConflictDoNothing();

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
