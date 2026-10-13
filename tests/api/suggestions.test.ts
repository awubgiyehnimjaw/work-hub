import { beforeEach, expect, test } from "vitest";
import { GET } from "@/app/api/suggestions/route";
import { db } from "@/lib/db/client";
import { clients, suggestions } from "@/lib/db/schema";

beforeEach(async () => {
  await db.delete(clients);
  await db.delete(suggestions);
});

test("GET /api/suggestions returns a seed suggestion as JSON when no client is quiet", async () => {
  await db.insert(suggestions).values({
    category: "general",
    text: "Only seed suggestion",
    active: true,
    lastPickedAt: null,
  });

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body).toEqual({ text: "Only seed suggestion", source: "seed" });
});

test("GET /api/suggestions returns a client-quiet suggestion when a client has gone quiet", async () => {
  const fiveWeeksAgo = new Date(Date.now() - 5 * 7 * 24 * 60 * 60 * 1000);
  const [client] = await db
    .insert(clients)
    .values({
      tag: "QuietCo",
      displayName: "QuietCo",
      recognized: true,
      lastActivityAt: fiveWeeksAgo,
    })
    .returning();

  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(body.source).toBe("client-quiet");
  expect(body.clientId).toBe(client.id);
});
