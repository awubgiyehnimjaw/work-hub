import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, contentIdeas } from "@/lib/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PatchPayload {
  clientId?: string;
  text?: string;
}

async function parsePatchPayload(body: unknown): Promise<PatchPayload | null> {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { clientId, text } = body as Record<string, unknown>;
  const update: PatchPayload = {};

  if (clientId !== undefined) {
    if (typeof clientId !== "string" || !UUID_RE.test(clientId)) {
      return null;
    }
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!client) {
      return null;
    }
    update.clientId = clientId;
  }
  if (text !== undefined) {
    if (typeof text !== "string" || text.trim().length === 0) {
      return null;
    }
    update.text = text.trim();
  }

  if (Object.keys(update).length === 0) {
    return null;
  }
  return update;
}

/** Edits a content idea's text and/or reassigns it to a different client. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body: unknown = await request.json().catch(() => null);
  const payload = await parsePatchPayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must include at least one of { clientId, text }, and clientId must reference an existing client" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(contentIdeas)
    .set(payload)
    .where(eq(contentIdeas.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Content idea not found" }, { status: 404 });
  }
  return NextResponse.json(updated, { status: 200 });
}

/** Permanently removes a content idea. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const [deleted] = await db.delete(contentIdeas).where(eq(contentIdeas.id, id)).returning();

  if (!deleted) {
    return NextResponse.json({ error: "Content idea not found" }, { status: 404 });
  }
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
