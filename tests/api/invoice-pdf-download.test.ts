import { beforeEach, expect, test } from "vitest";
import { GET } from "@/app/api/invoices/[id]/pdf/route";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
});

test("GET /api/invoices/[id]/pdf returns a PDF with the invoice number as the filename", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const [invoice] = await db.insert(invoices).values({
    invoiceNumber: "ARC2610-099", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X",
    invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-08"), description: null, totalAmountCents: 100,
  }).returning();

  const res = await GET(new Request("http://localhost/api/invoices/x/pdf"), context(invoice.id));

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/pdf");
  expect(res.headers.get("Content-Disposition")).toContain("ARC2610-099.pdf");
});

test("GET /api/invoices/[id]/pdf?mode=inline returns Content-Disposition: inline, for in-app preview", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const [invoice] = await db.insert(invoices).values({
    invoiceNumber: "ARC2610-100", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X",
    invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-08"), description: null, totalAmountCents: 100,
  }).returning();

  const res = await GET(new Request("http://localhost/api/invoices/x/pdf?mode=inline"), context(invoice.id));

  expect(res.status).toBe(200);
  const disposition = res.headers.get("Content-Disposition");
  expect(disposition).toContain("inline");
  expect(disposition).toContain("ARC2610-100.pdf");
});

test("GET /api/invoices/[id]/pdf returns 404 for a nonexistent invoice", async () => {
  const res = await GET(new Request("http://localhost/api/invoices/x/pdf"), context("00000000-0000-0000-0000-000000000000"));
  expect(res.status).toBe(404);
});
