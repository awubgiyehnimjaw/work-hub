import { beforeEach, expect, test } from "vitest";
import { GET, POST } from "@/app/api/clients/all/route";
import { DELETE, PATCH } from "@/app/api/clients/[id]/route";
import { GET as GET_STATS } from "@/app/api/clients/stats/route";
import { db } from "@/lib/db/client";
import { clients, tasks } from "@/lib/db/schema";

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
