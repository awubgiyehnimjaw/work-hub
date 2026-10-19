import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, invoices } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";

const ELIGIBLE = { legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: "#01-01, Singapore 000000", attention: "Account Department" };

beforeEach(async () => {
  await db.delete(invoices);
  await db.delete(clients);
});

test("creates the first invoice of a month as sequence 001", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();

  const result = await createInvoice({ clientId: client.id, description: "*4 Content Posts", totalAmountCents: 100000, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.invoice.invoiceNumber).toBe("ARC2611-001");
    expect(result.invoice.clientLegalName).toBe("TEST CO PTE LTD");
    expect(result.invoice.clientAddressLine2).toBe("#01-01, Singapore 000000");
    expect(result.invoice.dueDate).toEqual(new Date("2026-11-08T01:00:00Z"));
  }
});

test("increments the sequence for a second invoice in the same month", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();
  await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-20T01:00:00Z") });

  expect(result.ok && result.invoice.invoiceNumber).toBe("ARC2611-002");
});

test("resets the sequence to 001 in a new month", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();
  await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-10-31T01:00:00Z") });

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  expect(result.ok && result.invoice.invoiceNumber).toBe("ARC2611-001");
});

test("returns client_not_found for a nonexistent client", async () => {
  const result = await createInvoice({ clientId: "00000000-0000-0000-0000-000000000000", description: null, totalAmountCents: 1 });
  expect(result).toEqual({ ok: false, error: "client_not_found" });
});

test("returns client_not_eligible when the client has no legalName/addressLine1", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null }).returning();
  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1 });
  expect(result).toEqual({ ok: false, error: "client_not_eligible" });
});

test("defaults clientAttention to 'Account Department' when the client has no attention set", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: null, attention: null,
  }).returning();

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1 });

  expect(result.ok && result.invoice.clientAttention).toBe("Account Department");
});

test("treats a whitespace-only attention/addressLine2 on the client as missing (defense in depth)", async () => {
  const [client] = await db.insert(clients).values({
    tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null,
    legalName: "TEST CO PTE LTD", addressLine1: "1 Test Road", addressLine2: "   ", attention: "   ",
  }).returning();

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1 });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.invoice.clientAttention).toBe("Account Department");
    expect(result.invoice.clientAddressLine2).toBeNull();
  }
});

test("recovers from an invoiceNumber collision by retrying with the next sequence", async () => {
  const [client] = await db.insert(clients).values({ tag: "t1", displayName: "T1", recognized: true, lastActivityAt: null, ...ELIGIBLE }).returning();
  // With exactly one pre-existing row in the target month, nextSequence's
  // first computation is 1 (existing row count) + 1 = 2, so createInvoice's
  // first candidate is "ARC2611-002" — pre-inserting that exact number
  // forces a real unique-constraint collision on the first insert attempt,
  // so the retry branch (sequence bumped to 3) is what actually produces
  // the final "ARC2611-003" result, not an incidental pass.
  await db.insert(invoices).values({
    invoiceNumber: "ARC2611-002", clientId: client.id, clientLegalName: "X", clientAddressLine1: "X", clientAddressLine2: null, clientAttention: "X",
    invoiceDate: new Date("2026-11-01T00:00:00Z"), dueDate: new Date("2026-11-08T00:00:00Z"), description: null, totalAmountCents: 1,
  });

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1, invoiceDate: new Date("2026-11-01T01:00:00Z") });

  expect(result.ok && result.invoice.invoiceNumber).toBe("ARC2611-003");
});
