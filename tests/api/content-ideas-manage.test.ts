import { beforeEach, expect, test } from "vitest";
import { GET, POST } from "@/app/api/content-ideas/all/route";
import { DELETE, PATCH } from "@/app/api/content-ideas/[id]/route";
import { db } from "@/lib/db/client";
import { clients, contentIdeas } from "@/lib/db/schema";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/content-ideas/all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/content-ideas/placeholder", {
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
  await db.delete(contentIdeas);
  await db.delete(clients);
});

test("GET /api/content-ideas/all returns ideas joined with client name, grouped order", async () => {
  const [alpha] = await db
    .insert(clients)
    .values({ tag: "alpha", displayName: "Alpha Co", recognized: true, lastActivityAt: null })
    .returning();
  const [beta] = await db
    .insert(clients)
    .values({ tag: "beta", displayName: "Beta Co", recognized: true, lastActivityAt: null })
    .returning();

  await db.insert(contentIdeas).values({ clientId: beta.id, text: "beta idea" });
  const [olderAlpha] = await db
    .insert(contentIdeas)
    .values({ clientId: alpha.id, text: "older alpha idea", createdAt: new Date("2026-01-01T00:00:00Z") })
    .returning();
  await db
    .insert(contentIdeas)
    .values({ clientId: alpha.id, text: "newer alpha idea", createdAt: new Date("2026-02-01T00:00:00Z") });

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.map((idea: { text: string; clientName: string }) => [idea.clientName, idea.text])).toEqual([
    ["Alpha Co", "newer alpha idea"],
    ["Alpha Co", "older alpha idea"],
    ["Beta Co", "beta idea"],
  ]);
  expect(body.find((idea: { id: string }) => idea.id === olderAlpha.id).clientName).toBe("Alpha Co");
});

test("POST /api/content-ideas/all creates an idea and returns 201", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "arc", displayName: "ARC", recognized: true, lastActivityAt: null })
    .returning();

  const res = await POST(postRequest({ clientId: client.id, text: "before and after reel" }));
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.clientId).toBe(client.id);
  expect(body.text).toBe("before and after reel");

  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(1);
});

test("POST /api/content-ideas/all returns 400 for an invalid clientId", async () => {
  const res = await POST(postRequest({ clientId: "not-a-uuid", text: "an idea" }));
  expect(res.status).toBe(400);

  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(0);
});

test("POST /api/content-ideas/all returns 400 when clientId doesn't reference an existing client", async () => {
  const res = await POST(postRequest({ clientId: NONEXISTENT_ID, text: "an idea" }));
  expect(res.status).toBe(400);

  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(0);
});

test("POST /api/content-ideas/all returns 400 for empty text", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "arc", displayName: "ARC", recognized: true, lastActivityAt: null })
    .returning();

  const res = await POST(postRequest({ clientId: client.id, text: "" }));
  expect(res.status).toBe(400);

  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(0);
});

test("PATCH /api/content-ideas/:id updates text and clientId independently", async () => {
  const [client1] = await db
    .insert(clients)
    .values({ tag: "client1", displayName: "Client One", recognized: true, lastActivityAt: null })
    .returning();
  const [client2] = await db
    .insert(clients)
    .values({ tag: "client2", displayName: "Client Two", recognized: true, lastActivityAt: null })
    .returning();
  const [idea] = await db
    .insert(contentIdeas)
    .values({ clientId: client1.id, text: "original idea" })
    .returning();

  const res = await PATCH(patchRequest({ text: "updated idea" }), context(idea.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.text).toBe("updated idea");
  expect(body.clientId).toBe(client1.id);

  const res2 = await PATCH(patchRequest({ clientId: client2.id }), context(idea.id));
  expect(res2.status).toBe(200);
  const body2 = await res2.json();
  expect(body2.clientId).toBe(client2.id);
  expect(body2.text).toBe("updated idea");
});

test("PATCH /api/content-ideas/:id returns 404 for a nonexistent id", async () => {
  const res = await PATCH(patchRequest({ text: "x" }), context(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});

test("PATCH /api/content-ideas/:id returns 400 for an empty body", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "arc", displayName: "ARC", recognized: true, lastActivityAt: null })
    .returning();
  const [idea] = await db
    .insert(contentIdeas)
    .values({ clientId: client.id, text: "untouched" })
    .returning();

  const res = await PATCH(patchRequest({}), context(idea.id));
  expect(res.status).toBe(400);
});

test("DELETE /api/content-ideas/:id removes the row", async () => {
  const [client] = await db
    .insert(clients)
    .values({ tag: "arc", displayName: "ARC", recognized: true, lastActivityAt: null })
    .returning();
  const [idea] = await db
    .insert(contentIdeas)
    .values({ clientId: client.id, text: "delete me" })
    .returning();

  const res = await DELETE(new Request("http://localhost"), context(idea.id));
  expect(res.status).toBe(200);

  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(0);
});

test("DELETE /api/content-ideas/:id returns 404 for a nonexistent id", async () => {
  const res = await DELETE(new Request("http://localhost"), context(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});
