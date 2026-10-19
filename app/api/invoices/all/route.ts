import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";

/**
 * Full invoice list — every invoice, newest `invoiceDate` first, joined
 * with the client's CURRENT display name (`clientDisplayName`) rather than
 * the legal name snapshotted on the invoice — this is a UI label, not part
 * of the legal document, so it's fine for it to reflect a later rename.
 */
export async function GET() {
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      clientId: invoices.clientId,
      clientLegalName: invoices.clientLegalName,
      clientAddressLine1: invoices.clientAddressLine1,
      clientAddressLine2: invoices.clientAddressLine2,
      clientAttention: invoices.clientAttention,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      description: invoices.description,
      totalAmountCents: invoices.totalAmountCents,
      createdAt: invoices.createdAt,
      clientDisplayName: clients.displayName,
    })
    .from(invoices)
    .leftJoin(clients, eq(invoices.clientId, clients.id))
    .orderBy(desc(invoices.invoiceDate));

  return NextResponse.json(rows);
}

interface CreatePayload {
  clientId: string;
  description: string | null;
  totalAmountCents: number;
}

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { clientId, description, totalAmountCents } = body as Record<string, unknown>;
  if (typeof clientId !== "string" || clientId.length === 0) {
    return null;
  }
  if (!Number.isInteger(totalAmountCents) || (totalAmountCents as number) <= 0) {
    return null;
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    return null;
  }
  return {
    clientId,
    description: typeof description === "string" ? description : null,
    totalAmountCents: totalAmountCents as number,
  };
}

/** Creates an invoice for a client — the sole writer backing the Invoices page's "New invoice" form. */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const payload = parseCreatePayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Body must be { clientId: string, description?: string, totalAmountCents: a positive integer }" },
      { status: 400 },
    );
  }

  const result = await createInvoice({
    clientId: payload.clientId,
    description: payload.description,
    totalAmountCents: payload.totalAmountCents,
  });

  if (!result.ok) {
    if (result.error === "client_not_found") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Client has no billing profile (legalName/addressLine1)" },
      { status: 400 },
    );
  }

  return NextResponse.json(result.invoice, { status: 201 });
}
