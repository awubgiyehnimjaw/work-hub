import { expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, suggestions } from "@/lib/db/schema";
import { seedClients, seedSuggestions } from "@/lib/db/seed";

test("seedClients creates the known client tags exactly once each", async () => {
  await seedClients();
  await seedClients(); // idempotent

  const rows = await db.select().from(clients);
  const tags = rows.map((r) => r.tag).sort();

  expect(tags).toEqual(
    ["ARC", "HappyFish", "Lesamai", "Lovelots", "NLD", "That Place", "Ulti"].sort(),
  );
  expect(rows.every((r) => r.recognized === true)).toBe(true);
});

test("seedSuggestions creates the seeded suggestions exactly once each, grouped by category", async () => {
  await seedSuggestions();
  await seedSuggestions(); // idempotent

  const rows = await db.select().from(suggestions);

  expect(rows).toHaveLength(11);
  expect(rows.every((r) => r.active === true)).toBe(true);
  expect(rows.every((r) => r.lastPickedAt === null)).toBe(true);

  const byCategory = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {});
  expect(byCategory).toEqual({ ulti: 4, arc: 3, general: 4 });

  const texts = new Set(rows.map((r) => r.text));
  expect(texts.size).toBe(11);
});
