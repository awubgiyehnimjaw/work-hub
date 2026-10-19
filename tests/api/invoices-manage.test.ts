import { beforeEach, expect, test } from "vitest";
import { GET, POST } from "@/app/api/invoices/all/route";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/invoices/all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
});

test("POST /api/invoices/all creates an invoice and returns 201", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: null, attention: "Account Department",
  }).returning();

  const res = await POST(postRequest({ clientId: client.id, description: "*4 Content Posts", totalAmountCents: 100000 }));

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.invoiceNumber).toMatch(/^ARC\d{4}-\d{3}$/);
});

test("POST /api/invoices/all rejects a non-positive totalAmountCents", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: null, attention: "Account Department",
  }).returning();

  const res = await POST(postRequest({ clientId: client.id, totalAmountCents: 0 }));
  expect(res.status).toBe(400);
});

test("POST /api/invoices/all returns 404 for a nonexistent client", async () => {
  const res = await POST(postRequest({ clientId: "00000000-0000-0000-0000-000000000000", totalAmountCents: 100 }));
  expect(res.status).toBe(404);
});

test("POST /api/invoices/all returns 400 for a client with no billing profile", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const res = await POST(postRequest({ clientId: client.id, totalAmountCents: 100 }));
  expect(res.status).toBe(400);
});

test("GET /api/invoices/all returns invoices newest invoiceDate first, with clientDisplayName", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "Display Name", recognized: true, lastActivityAt: null }).returning();
  await db.insert(invoices).values([
    { invoiceNumber: "ARC2610-001", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X", invoiceDate: new Date("2026-10-01"), dueDate: new Date("2026-10-08"), description: null, totalAmountCents: 100 },
    { invoiceNumber: "ARC2610-002", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X", invoiceDate: new Date("2026-10-15"), dueDate: new Date("2026-10-22"), description: null, totalAmountCents: 200 },
  ]);

  const res = await GET();
  const body = await res.json();
  expect(body.map((row: { invoiceNumber: string }) => row.invoiceNumber)).toEqual(["ARC2610-002", "ARC2610-001"]);
  expect(body[0].clientDisplayName).toBe("Display Name");
});
