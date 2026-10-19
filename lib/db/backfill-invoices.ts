import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";

interface BackfillSpec {
  expectedNumber: string;
  clientTag: string;
  description: string;
  totalAmountCents: number;
  invoiceDate: Date;
}

/**
 * Ensures exactly one of the two known October invoices exists, guarding
 * each independently rather than short-circuiting the whole script on a
 * single shared check. A single `invoiceNumber = "ARC2610-001"` guard
 * covering both invoices has two real failure modes: (1) if the real app
 * generates an invoice for some other client before this script runs, it
 * can claim "ARC2610-001" for itself — the old guard would then see that
 * number already exists and silently do nothing, leaving a genuine
 * numbering collision in place and the Lovelots backfill never recorded;
 * (2) if That Place's insert succeeds but Lovelots' fails (transient DB
 * error, client not eligible, etc.), a re-run would see "ARC2610-001"
 * already exists and return early, permanently skipping Lovelots with no
 * error raised. Guarding by (clientId, invoiceDate, totalAmountCents) for
 * each invoice independently — rather than by invoice number alone — fixes
 * both: each backfill target is created if and only if it doesn't already
 * exist, regardless of what happened to the other one.
 */
async function ensureBackfilledInvoice(spec: BackfillSpec): Promise<void> {
  const [client] = await db.select().from(clients).where(eq(clients.tag, spec.clientTag));
  if (!client) {
    throw new Error(`backfillOctoberInvoices: client with tag "${spec.clientTag}" not found`);
  }

  const alreadyBackfilled = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.clientId, client.id),
        eq(invoices.invoiceDate, spec.invoiceDate),
        eq(invoices.totalAmountCents, spec.totalAmountCents),
      ),
    );
  if (alreadyBackfilled.length > 0) {
    // This exact invoice has already been backfilled (e.g. a previous
    // partial run) — nothing to do for this one.
    return;
  }

  // The expected number isn't claimed by *this* backfill yet (checked
  // above) — if it's claimed by anything else, something else got there
  // first (most likely: this script is being run too late, after a real
  // invoice already consumed that number). Proceeding would either skip
  // this backfill silently or collide; fail loudly instead.
  const [numberClaimedByOther] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.invoiceNumber, spec.expectedNumber));
  if (numberClaimedByOther) {
    throw new Error(
      `backfillOctoberInvoices: "${spec.expectedNumber}" already exists but doesn't match the ` +
        `expected ${spec.clientTag} backfill (existing: clientId=${numberClaimedByOther.clientId}, ` +
        `invoiceDate=${numberClaimedByOther.invoiceDate.toISOString()}, ` +
        `totalAmountCents=${numberClaimedByOther.totalAmountCents}; expected: clientId=${client.id}, ` +
        `invoiceDate=${spec.invoiceDate.toISOString()}, totalAmountCents=${spec.totalAmountCents}). ` +
        `This usually means the backfill is being run after that number was already issued by ` +
        `something else (e.g. a real invoice generated through the app) — investigate before ` +
        `re-running this script.`,
    );
  }

  const result = await createInvoice({
    clientId: client.id,
    description: spec.description,
    totalAmountCents: spec.totalAmountCents,
    invoiceDate: spec.invoiceDate,
  });
  if (!result.ok) {
    throw new Error(
      `backfillOctoberInvoices: createInvoice for "${spec.clientTag}" failed: ${result.error}`,
    );
  }
}

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
 * real invoice numbers already issued — but each is now guarded
 * independently (see `ensureBackfilledInvoice`), so a partial prior run
 * (one created, one not) is completed rather than skipped, and a real
 * numbering collision raises a clear error rather than being silently
 * left in place.
 */
export async function backfillOctoberInvoices(): Promise<void> {
  await ensureBackfilledInvoice({
    expectedNumber: "ARC2610-001",
    clientTag: "That Place",
    description: "Remaining amount",
    totalAmountCents: 100000,
    invoiceDate: new Date("2026-10-01T01:00:00Z"),
  });

  await ensureBackfilledInvoice({
    expectedNumber: "ARC2610-002",
    clientTag: "Lovelots",
    description: "*8 Content Posts",
    totalAmountCents: 160000,
    invoiceDate: new Date("2026-10-04T01:00:00Z"),
  });
}
