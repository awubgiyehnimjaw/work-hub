import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { isForeignKeyViolation, isUniqueConstraintViolation } from "@/lib/db/pg-errors";
import { clients } from "@/lib/db/schema";

interface PatchPayload {
  tag?: string;
  displayName?: string;
  recognized?: boolean;
}

function parsePatchPayload(body: unknown): PatchPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { tag, displayName, recognized } = body as Record<string, unknown>;
  const update: PatchPayload = {};

  if (tag !== undefined) {
    if (typeof tag !== "string" || tag.trim().length === 0) {
      return null;
    }
    update.tag = tag.trim();
  }
  if (displayName !== undefined) {
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return null;
    }
    update.displayName = displayName.trim();
  }
  if (recognized !== undefined) {
    if (typeof recognized !== "boolean") {
      return null;
    }
    update.recognized = recognized;
  }

  if (Object.keys(update).length === 0) {
    return null;
  }
  return update;
}

/** Edits a client's tag/display name, or toggles it recognized/unrecognized. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const payload = parsePatchPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must include at least one of { tag, displayName, recognized }" },
      { status: 400 },
    );
  }

  try {
    const [updated] = await db
      .update(clients)
      .set(payload)
      .where(eq(clients.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json(updated, { status: 200 });
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

/**
 * Permanently removes a client. Blocked by the database's own foreign-key
 * constraint (`tasks.client_id` has no `ON DELETE` action) whenever a task
 * still references it — surfaced as a 409 rather than a crash, since a
 * client with review history is exactly the case this should refuse.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const [deleted] = await db.delete(clients).where(eq(clients.id, id)).returning();

    if (!deleted) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    if (isForeignKeyViolation(error, "tasks_client_id_clients_id_fk")) {
      return NextResponse.json(
        { error: "Can't delete — this client has existing review tasks" },
        { status: 409 },
      );
    }
    throw error;
  }
}
