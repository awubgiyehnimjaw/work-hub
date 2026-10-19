import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";
import { seedClients, seedClientBillingProfiles } from "@/lib/db/seed";
import { backfillOctoberInvoices } from "@/lib/db/backfill-invoices";

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
  await seedClients();
  await seedClientBillingProfiles();
});

test("creates ARC2610-001 for That Place and ARC2610-002 for Lovelots with the real figures", async () => {
  await backfillOctoberInvoices();

  const rows = await db.select().from(invoices);
  const thatPlace = rows.find((r) => r.invoiceNumber === "ARC2610-001")!;
  const lovelots = rows.find((r) => r.invoiceNumber === "ARC2610-002")!;

  expect(thatPlace.totalAmountCents).toBe(100000);
  expect(thatPlace.description).toBe("Remaining amount");
  expect(lovelots.totalAmountCents).toBe(160000);
  expect(lovelots.description).toBe("*8 Content Posts");
});

test("is idempotent — running it twice doesn't create duplicates", async () => {
  await backfillOctoberInvoices();
  await backfillOctoberInvoices();

  const rows = await db.select().from(invoices);
  expect(rows).toHaveLength(2);
});

test("partial state: creates only the missing Lovelots invoice when That Place's has already been backfilled", async () => {
  const [thatPlace] = await db.select().from(clients).where(eq(clients.tag, "That Place"));
  // Simulates a prior partial run (or the real backfill having already
  // happened for this one) — only That Place's invoice exists so far.
  const preexisting = await createInvoice({
    clientId: thatPlace.id,
    description: "Remaining amount",
    totalAmountCents: 100000,
    invoiceDate: new Date("2026-10-01T01:00:00Z"),
  });
  expect(preexisting.ok).toBe(true);

  await backfillOctoberInvoices();

  const rows = await db.select().from(invoices);
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.invoiceNumber).sort()).toEqual(["ARC2610-001", "ARC2610-002"]);
  const lovelots = rows.find((r) => r.invoiceNumber === "ARC2610-002")!;
  expect(lovelots.totalAmountCents).toBe(160000);
  expect(lovelots.description).toBe("*8 Content Posts");
});

test("throws a clear error if ARC2610-001 already belongs to a different invoice than the expected backfill", async () => {
  const [thatPlace] = await db.select().from(clients).where(eq(clients.tag, "That Place"));
  // Simulates the real app issuing ARC2610-001 to some client (any client —
  // the point is the date/amount don't match what the backfill expects)
  // before this script ran.
  await db.insert(invoices).values({
    invoiceNumber: "ARC2610-001",
    clientId: thatPlace.id,
    clientLegalName: "X",
    clientAddressLine1: "X",
    clientAddressLine2: null,
    clientAttention: "X",
    invoiceDate: new Date("2026-10-15T01:00:00Z"),
    dueDate: new Date("2026-10-22T01:00:00Z"),
    description: null,
    totalAmountCents: 500000,
  });

  await expect(backfillOctoberInvoices()).rejects.toThrow(/ARC2610-001/);

  // And it must not have gone on to create the Lovelots invoice either —
  // failing loudly, not partially.
  const lovelotsRows = await db.select().from(invoices).where(eq(invoices.invoiceNumber, "ARC2610-002"));
  expect(lovelotsRows).toHaveLength(0);
});
