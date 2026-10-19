import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { isUniqueConstraintViolation } from "@/lib/db/pg-errors";
import { clients, invoices } from "@/lib/db/schema";
import { computeDueDate, formatInvoiceNumber, sgtYearMonthKey } from "@/lib/invoices/format";

export interface CreateInvoiceInput {
  clientId: string;
  description: string | null;
  totalAmountCents: number;
  invoiceDate?: Date;
}

export type CreateInvoiceResult =
  | { ok: true; invoice: typeof invoices.$inferSelect }
  | { ok: false; error: "client_not_found" | "client_not_eligible" };

const DEFAULT_ATTENTION = "Account Department";
const MAX_ATTEMPTS = 3;

/**
 * Next sequence number for `invoiceDate`'s SGT calendar month — counted by
 * scanning every existing invoice rather than a SQL date-range query. The
 * table is small (single-user, low volume), so this is simpler and cheap.
 */
async function nextSequence(invoiceDate: Date): Promise<number> {
  const existing = await db.select({ invoiceDate: invoices.invoiceDate }).from(invoices);
  const targetKey = sgtYearMonthKey(invoiceDate);
  const sameMonth = existing.filter((row) => sgtYearMonthKey(row.invoiceDate) === targetKey);
  return sameMonth.length + 1;
}

/**
 * Creates an invoice for `input.clientId`, snapshotting the client's
 * billing-profile fields onto the row so the document stays stable even if
 * the client's profile changes later. Shared by this task's own `POST`
 * route and Task 6's backfill script.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<CreateInvoiceResult> {
  const [client] = await db.select().from(clients).where(eq(clients.id, input.clientId));
  if (!client) {
    return { ok: false, error: "client_not_found" };
  }
  if (!client.legalName || !client.addressLine1) {
    return { ok: false, error: "client_not_eligible" };
  }

  const invoiceDate = input.invoiceDate ?? new Date();
  const dueDate = computeDueDate(invoiceDate);

  let sequence = await nextSequence(invoiceDate);
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const invoiceNumber = formatInvoiceNumber(invoiceDate, sequence);
    try {
      const [invoice] = await db
        .insert(invoices)
        .values({
          invoiceNumber,
          clientId: client.id,
          clientLegalName: client.legalName,
          clientAddressLine1: client.addressLine1,
          clientAddressLine2: client.addressLine2,
          clientAttention: client.attention ?? DEFAULT_ATTENTION,
          invoiceDate,
          dueDate,
          description: input.description,
          totalAmountCents: input.totalAmountCents,
        })
        .returning();
      return { ok: true, invoice };
    } catch (error) {
      if (isUniqueConstraintViolation(error, "invoices_invoice_number_unique")) {
        lastError = error;
        sequence += 1;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
