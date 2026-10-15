import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, contentIdeas } from "@/lib/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Full content-ideas list for the `/content-ideas` page — every idea,
 * joined with its client's display name, grouped by client (display name
 * ascending) and newest-first within each group.
 */
export async function GET() {
  const rows = await db
    .select({
      id: contentIdeas.id,
      clientId: contentIdeas.clientId,
      text: contentIdeas.text,
      createdAt: contentIdeas.createdAt,
      clientName: clients.displayName,
    })
    .from(contentIdeas)
    .leftJoin(clients, eq(contentIdeas.clientId, clients.id))
    .orderBy(asc(clients.displayName), desc(contentIdeas.createdAt));

  return NextResponse.json(rows);
}

interface CreatePayload {
  clientId: string;
  text: string;
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { clientId, text } = body as Record<string, unknown>;
  if (typeof clientId !== "string" || !UUID_RE.test(clientId)) {
    return null;
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return null;
  }
  return { clientId, text: text.trim() };
}

/** Adds a content idea for a client — the Telegram webhook and this page's own add form are the only two writers. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const payload = parseCreatePayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must be { clientId: string, text: string }" },
      { status: 400 },
    );
  }

  const [client] = await db.select().from(clients).where(eq(clients.id, payload.clientId));
  if (!client) {
    return NextResponse.json(
      { error: "clientId does not reference an existing client" },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(contentIdeas)
    .values({ clientId: payload.clientId, text: payload.text })
    .returning();
  return NextResponse.json(created, { status: 201 });
}
