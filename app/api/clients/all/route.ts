import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { isUniqueConstraintViolation } from "@/lib/db/pg-errors";
import { clients } from "@/lib/db/schema";

/**
 * Full client list for the management UI (recognized and not), ordered by
 * display name. Distinct from any poll-internal lookup — this is the only
 * route the `/clients` page reads from.
 */
export async function GET() {
  const rows = await db.select().from(clients).orderBy(asc(clients.displayName));
  return NextResponse.json(rows);
}

interface CreatePayload {
  tag: string;
  displayName: string;
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { tag, displayName } = body as Record<string, unknown>;
  if (typeof tag !== "string" || tag.trim().length === 0) {
    return null;
  }
  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    return null;
  }
  return { tag: tag.trim(), displayName: displayName.trim() };
}

/**
 * Registers a client ahead of time so the next matching Frame.io upload is
 * recognized immediately instead of landing as an "unrecognized" row —
 * always created `recognized: true`, since that's the whole point of
 * adding one here rather than waiting for `lib/frameio/poll.ts` to
 * auto-create it.
 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const payload = parseCreatePayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must be { tag: string, displayName: string }" },
      { status: 400 },
    );
  }

  try {
    const [created] = await db
      .insert(clients)
      .values({
        tag: payload.tag,
        displayName: payload.displayName,
        recognized: true,
        lastActivityAt: null,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintViolation(error, "clients_tag_unique")) {
      return NextResponse.json(
        { error: "A client with that tag already exists" },
        { status: 409 },
      );
    }
    throw error;
  }
}
