import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { GET, POST } from "@/app/api/clients/all/route";
import { DELETE, PATCH } from "@/app/api/clients/[id]/route";
import { GET as GET_STATS } from "@/app/api/clients/stats/route";
import { db } from "@/lib/db/client";
import { clients, contentIdeas, invoices, tasks } from "@/lib/db/schema";
import { createInvoice } from "@/lib/invoices/create";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/clients/all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/clients/placeholder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(contentIdeas);
  await db.delete(invoices);
  await db.delete(clients);
});

test("GET /api/clients/all returns every client ordered by display name", async () => {
  await db.insert(clients).values([
    { tag: "zzz", displayName: "Zed Client", recognized: true, lastActivityAt: null },
    { tag: "aaa", displayName: "Alpha Client", recognized: false, lastActivityAt: null },
  ]);

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.map((c: { displayName: string }) => c.displayName)).toEqual([
    "Alpha Client",
    "Zed Client",
  ]);
  expect(body.find((c: { displayName: string }) => c.displayName === "Alpha Client").recognized).toBe(false);
});

test("POST /api/clients/all creates a recognized client and returns 201", async () => {
  const res = await POST(postRequest({ tag: "newco", displayName: "New Co" }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.tag).toBe("newco");
  expect(body.displayName).toBe("New Co");
  expect(body.recognized).toBe(true);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(1);
});

test("POST /api/clients/all returns 400 when tag or displayName is missing", async () => {
  const res = await POST(postRequest({ tag: "newco" }));
  expect(res.status).toBe(400);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(0);
});

test("POST /api/clients/all returns 409 for a duplicate tag instead of crashing", async () => {
  await db.insert(clients).values({ tag: "dupe", displayName: "Dupe Co", recognized: true, lastActivityAt: null });

  const res = await POST(postRequest({ tag: "dupe", displayName: "Another Co" }));
  expect(res.status).toBe(409);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(1);
});

test("PATCH /api/clients/:id updates tag, displayName, and recognized independently", async () => {
  const [row] = await db
    .insert(clients)
    .values({ tag: "oldtag", displayName: "Old Name", recognized: false, lastActivityAt: null })
    .returning();

  const res = await PATCH(patchRequest({ recognized: true }), context(row.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.recognized).toBe(true);
  expect(body.displayName).toBe("Old Name");
});

test("PATCH /api/clients/:id returns 404 for a nonexistent id", async () => {
  const res = await PATCH(patchRequest({ recognized: true }), context(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});

test("PATCH /api/clients/:id returns 400 when the body has none of tag/displayName/recognized", async () => {
  const [row] = await db
    .insert(clients)
    .values({ tag: "tag1", displayName: "Name 1", recognized: true, lastActivityAt: null })
    .returning();

  const res = await PATCH(patchRequest({}), context(row.id));
  expect(res.status).toBe(400);
});

test("PATCH /api/clients/:id returns 409 when the new tag collides with another client", async () => {
  await db.insert(clients).values({ tag: "taken", displayName: "Taken Co", recognized: true, lastActivityAt: null });
  const [row] = await db
    .insert(clients)
    .values({ tag: "free", displayName: "Free Co", recognized: true, lastActivityAt: null })
    .returning();

  const res = await PATCH(patchRequest({ tag: "taken" }), context(row.id));
  expect(res.status).toBe(409);
});

test("DELETE /api/clients/:id removes a client with no tasks", async () => {
  const [row] = await db
    .insert(clients)
    .values({ tag: "deleteme", displayName: "Delete Me", recognized: true, lastActivityAt: null })
    .returning();

  const res = await DELETE(new Request("http://localhost"), context(row.id));
  expect(res.status).toBe(200);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(0);
});

test("DELETE /api/clients/:id returns 404 for a nonexistent id", async () => {
  const res = await DELETE(new Request("http://localhost"), context(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});

test("DELETE /api/clients/:id returns 409 instead of crashing when the client still has tasks", async () => {
  const [row] = await db
    .insert(clients)
    .values({ tag: "busy", displayName: "Busy Co", recognized: true, lastActivityAt: null })
    .returning();
  await db.insert(tasks).values({
    type: "review",
    title: "Review something",
    clientId: row.id,
    status: "active",
  });

  const res = await DELETE(new Request("http://localhost"), context(row.id));
  expect(res.status).toBe(409);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(1);
});

test("DELETE /api/clients/:id returns 409 instead of crashing when the client still has content ideas", async () => {
  const [row] = await db
    .insert(clients)
    .values({ tag: "idea-haver", displayName: "Idea Co", recognized: true, lastActivityAt: null })
    .returning();
  await db.insert(contentIdeas).values({ clientId: row.id, text: "an idea" });

  const res = await DELETE(new Request("http://localhost"), context(row.id));
  expect(res.status).toBe(409);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(1);
});

test("DELETE /api/clients/:id returns 409 instead of crashing when the client still has invoices", async () => {
  const [row] = await db
    .insert(clients)
    .values({
      tag: "invoiced",
      displayName: "Invoiced Co",
      recognized: true,
      lastActivityAt: null,
      legalName: "INVOICED CO PTE LTD",
      addressLine1: "1 Invoice Road",
      addressLine2: null,
      attention: "Account Department",
    })
    .returning();
  await db.insert(invoices).values({
    invoiceNumber: "ARC2699-001",
    clientId: row.id,
    clientLegalName: "X",
    clientAddressLine1: "X",
    clientAddressLine2: null,
    clientAttention: "X",
    invoiceDate: new Date("2026-10-01"),
    dueDate: new Date("2026-10-08"),
    description: null,
    totalAmountCents: 100,
  });

  const res = await DELETE(new Request("http://localhost"), context(row.id));
  expect(res.status).toBe(409);

  const rows = await db.select().from(clients);
  expect(rows).toHaveLength(1);
});

test("PATCH /api/clients/[id] updates the billing fields", async () => {
  const [client] = await db.insert(clients).values({ tag: "billing-test", displayName: "Billing Test", recognized: true, lastActivityAt: null }).returning();

  const res = await PATCH(
    patchRequest({ legalName: "BILLING TEST PTE LTD", addressLine1: "1 Test Road", addressLine2: "#01-01, Singapore 000000", attention: "Finance" }),
    context(client.id),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.legalName).toBe("BILLING TEST PTE LTD");
  expect(body.addressLine1).toBe("1 Test Road");
  expect(body.addressLine2).toBe("#01-01, Singapore 000000");
  expect(body.attention).toBe("Finance");
});

test("PATCH /api/clients/[id] normalizes empty-string billing fields to null, not an empty string", async () => {
  const [client] = await db
    .insert(clients)
    .values({
      tag: "blank-billing",
      displayName: "Blank Billing",
      recognized: true,
      lastActivityAt: null,
      legalName: "OLD LEGAL NAME PTE LTD",
      addressLine1: "Old Address",
      addressLine2: "Old Line 2",
      attention: "Old Attention",
    })
    .returning();

  const res = await PATCH(
    patchRequest({ attention: "", addressLine2: "" }),
    context(client.id),
  );

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.attention).toBeNull();
  expect(body.addressLine2).toBeNull();

  const [row] = await db.select().from(clients).where(eq(clients.id, client.id));
  expect(row.attention).toBeNull();
  expect(row.addressLine2).toBeNull();
});

test("PATCH clearing attention/addressLine2 to empty string, then createInvoice, applies the real defaults", async () => {
  const [client] = await db
    .insert(clients)
    .values({
      tag: "blank-billing-2",
      displayName: "Blank Billing 2",
      recognized: true,
      lastActivityAt: null,
      legalName: "BLANK BILLING PTE LTD",
      addressLine1: "1 Blank Road",
      addressLine2: "Old Line 2",
      attention: "Old Attention",
    })
    .returning();

  const patchRes = await PATCH(
    patchRequest({ attention: "", addressLine2: "" }),
    context(client.id),
  );
  expect(patchRes.status).toBe(200);

  const result = await createInvoice({ clientId: client.id, description: null, totalAmountCents: 1 });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.invoice.clientAttention).toBe("Account Department");
    expect(result.invoice.clientAddressLine2).toBeNull();
  }
});

test("PATCH /api/clients/[id] with only displayName does not clear legalName to an empty string", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "rename-only", displayName: "Old Name", recognized: true, lastActivityAt: null })
    .returning();
  expect(client.legalName).toBeNull();

  const res = await PATCH(patchRequest({ displayName: "New Name" }), context(client.id));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.displayName).toBe("New Name");
  expect(body.legalName).toBeNull();
});

test("GET /api/clients/stats returns a stats row per client, sorted by display name", async () => {
  const [c1] = await db
    .insert(clients)
    .values({ tag: "b", displayName: "Beta Co", recognized: true, lastActivityAt: null })
    .returning();
  await db.insert(clients).values({ tag: "a", displayName: "Alpha Co", recognized: true, lastActivityAt: null });

  await db.insert(tasks).values({
    type: "review",
    title: "Review something",
    clientId: c1.id,
    status: "completed",
    completedAt: new Date(),
  });

  const res = await GET_STATS();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.map((c: { displayName: string }) => c.displayName)).toEqual(["Alpha Co", "Beta Co"]);
  expect(body.find((c: { displayName: string }) => c.displayName === "Beta Co").completedCount).toBe(1);
});
