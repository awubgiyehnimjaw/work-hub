import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { isForeignKeyViolation, isUniqueConstraintViolation } from "@/lib/db/pg-errors";
import { clients } from "@/lib/db/schema";

interface PatchPayload {
  tag?: string;
  displayName?: string;
  recognized?: boolean;
  legalName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  attention?: string | null;
}

function parsePatchPayload(body: unknown): PatchPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { tag, displayName, recognized, legalName, addressLine1, addressLine2, attention } =
    body as Record<string, unknown>;
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
  // The four billing fields clear to `null` (not `""`) when sent blank —
  // the Clients page form always sends all four on every save, even one
  // that only touched tag/displayName, so a trimmed-empty string here must
  // mean "no value" to downstream consumers that check for null
  // (`createInvoice`'s `??` defaulting, the billing-profile seed's
  // `isNull(clients.legalName)` idempotency guard) rather than "" being
  // treated as a real (blank) value.
  if (legalName !== undefined) {
    if (typeof legalName !== "string") {
      return null;
    }
    const trimmed = legalName.trim();
    update.legalName = trimmed.length === 0 ? null : trimmed;
  }
  if (addressLine1 !== undefined) {
    if (typeof addressLine1 !== "string") {
      return null;
    }
    const trimmed = addressLine1.trim();
    update.addressLine1 = trimmed.length === 0 ? null : trimmed;
  }
  if (addressLine2 !== undefined) {
    if (typeof addressLine2 !== "string") {
      return null;
    }
    const trimmed = addressLine2.trim();
    update.addressLine2 = trimmed.length === 0 ? null : trimmed;
  }
  if (attention !== undefined) {
    if (typeof attention !== "string") {
      return null;
    }
    const trimmed = attention.trim();
    update.attention = trimmed.length === 0 ? null : trimmed;
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
      {
        error:
          "Body must include at least one of { tag, displayName, recognized, legalName, addressLine1, addressLine2, attention }",
      },
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
 * constraints (`tasks.client_id`, `content_ideas.client_id`, and
 * `invoices.client_id` all have no `ON DELETE` action) whenever a task,
 * content idea, or invoice still references it — surfaced as a 409 rather
 * than a crash, since a client with review/invoice history is exactly the
 * case this should refuse.
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
    if (
      isForeignKeyViolation(error, "tasks_client_id_clients_id_fk") ||
      isForeignKeyViolation(error, "content_ideas_client_id_clients_id_fk") ||
      isForeignKeyViolation(error, "invoices_client_id_clients_id_fk")
    ) {
      return NextResponse.json(
        { error: "Can't delete — this client has existing review tasks, content ideas, or invoices" },
        { status: 409 },
      );
    }
    throw error;
  }
}
