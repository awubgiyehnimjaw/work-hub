import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";

/**
 * Backfills the two real invoices issued to That Place and Lovelots in
 * October 2026 — before this app's Invoices feature existed — so this
 * app's own invoice-number sequence counter starts from `ARC2610-003`
 * rather than colliding with numbers already in use with those clients.
 *
 * Deliberately runs the two `createInvoice` calls in this exact order
 * (That Place, then Lovelots) and relies entirely on Task 3's real
 * sequence-counting logic (not a hardcoded invoice number anywhere here)
 * to naturally produce `ARC2610-001` then `ARC2610-002`, matching the
 * real invoice numbers already issued.
 *
 * Idempotent: if `ARC2610-001` already exists, this returns immediately
 * without doing anything, so running it twice (e.g. a retried deploy
 * step) never creates duplicates.
 */
export async function backfillOctoberInvoices(): Promise<void> {
  const [existing] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "ARC2610-001"));
  if (existing) {
    return;
  }

  const [thatPlace] = await db.select().from(clients).where(eq(clients.tag, "That Place"));
  if (!thatPlace) {
    throw new Error('backfillOctoberInvoices: client with tag "That Place" not found');
  }
  const thatPlaceResult = await createInvoice({
    clientId: thatPlace.id,
    description: "Remaining amount",
    totalAmountCents: 100000,
    invoiceDate: new Date("2026-10-01T01:00:00Z"),
  });
  if (!thatPlaceResult.ok) {
    throw new Error(
      `backfillOctoberInvoices: createInvoice for "That Place" failed: ${thatPlaceResult.error}`,
    );
  }

  const [lovelots] = await db.select().from(clients).where(eq(clients.tag, "Lovelots"));
  if (!lovelots) {
    throw new Error('backfillOctoberInvoices: client with tag "Lovelots" not found');
  }
  const lovelotsResult = await createInvoice({
    clientId: lovelots.id,
    description: "*8 Content Posts",
    totalAmountCents: 160000,
    invoiceDate: new Date("2026-10-04T01:00:00Z"),
  });
  if (!lovelotsResult.ok) {
    throw new Error(
      `backfillOctoberInvoices: createInvoice for "Lovelots" failed: ${lovelotsResult.error}`,
    );
  }
}
