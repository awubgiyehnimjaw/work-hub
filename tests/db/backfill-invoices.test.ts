import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
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
