import { beforeEach, expect, test } from "vitest";
import { GET, POST } from "@/app/api/suggestions/all/route";
import { DELETE, PATCH } from "@/app/api/suggestions/[id]/route";
import { db } from "@/lib/db/client";
import { suggestions } from "@/lib/db/schema";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/suggestions/all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/suggestions/placeholder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

beforeEach(async () => {
  await db.delete(suggestions);
});

test("GET /api/suggestions/all returns every suggestion, active or not, ordered by category then text", async () => {
  await db.insert(suggestions).values([
    { category: "general", text: "B general idea", active: true },
    { category: "arc", text: "An arc idea", active: false },
    { category: "general", text: "A general idea", active: true },
  ]);

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.map((s: { text: string }) => s.text)).toEqual([
    "An arc idea",
    "A general idea",
    "B general idea",
  ]);
  expect(body.find((s: { text: string }) => s.text === "An arc idea").active).toBe(false);
});

test("POST /api/suggestions/all creates an active suggestion and returns 201", async () => {
  const res = await POST(postRequest({ category: "ulti", text: "Post a reel" }));
  expect(res.status).toBe(201);
  const body = await res.json();

  expect(body.category).toBe("ulti");
  expect(body.text).toBe("Post a reel");
  expect(body.active).toBe(true);

  const rows = await db.select().from(suggestions);
  expect(rows).toHaveLength(1);
});

test("POST /api/suggestions/all returns 400 for an invalid category", async () => {
  const res = await POST(postRequest({ category: "not-a-real-category", text: "Whatever" }));
  expect(res.status).toBe(400);

  const rows = await db.select().from(suggestions);
  expect(rows).toHaveLength(0);
});

test("POST /api/suggestions/all returns 409 for duplicate text instead of crashing", async () => {
  await db.insert(suggestions).values({ category: "general", text: "Same text", active: true });

  const res = await POST(postRequest({ category: "arc", text: "Same text" }));
  expect(res.status).toBe(409);

  const rows = await db.select().from(suggestions);
  expect(rows).toHaveLength(1);
});

test("PATCH /api/suggestions/:id updates text, category, and active independently", async () => {
  const [row] = await db
    .insert(suggestions)
    .values({ category: "general", text: "Original text", active: true })
    .returning();

  const res = await PATCH(patchRequest({ active: false }), patchContext(row.id));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.active).toBe(false);
  expect(body.text).toBe("Original text");
});

test("PATCH /api/suggestions/:id returns 404 for a nonexistent id", async () => {
  const res = await PATCH(patchRequest({ active: false }), patchContext(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});

test("PATCH /api/suggestions/:id returns 400 when the body has none of text/category/active", async () => {
  const [row] = await db
    .insert(suggestions)
    .values({ category: "general", text: "Untouched", active: true })
    .returning();

  const res = await PATCH(patchRequest({}), patchContext(row.id));
  expect(res.status).toBe(400);
});

test("DELETE /api/suggestions/:id removes the row", async () => {
  const [row] = await db
    .insert(suggestions)
    .values({ category: "general", text: "Delete me", active: true })
    .returning();

  const res = await DELETE(new Request("http://localhost"), patchContext(row.id));
  expect(res.status).toBe(200);

  const rows = await db.select().from(suggestions);
  expect(rows).toHaveLength(0);
});

test("DELETE /api/suggestions/:id returns 404 for a nonexistent id", async () => {
  const res = await DELETE(new Request("http://localhost"), patchContext(NONEXISTENT_ID));
  expect(res.status).toBe(404);
});
