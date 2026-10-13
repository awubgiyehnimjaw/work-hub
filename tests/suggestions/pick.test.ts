import { eq } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { clients, suggestions } from "@/lib/db/schema";
import { pickSuggestion } from "@/lib/suggestions/pick";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

beforeEach(async () => {
  await db.delete(clients);
  await db.delete(suggestions);
});

test("returns a client-quiet suggestion for a client quiet 4+ weeks, even when seed suggestions are available", async () => {
  const now = Date.now();
  const [quietClient] = await db
    .insert(clients)
    .values({
      tag: "QuietCo",
      displayName: "QuietCo",
      recognized: true,
      lastActivityAt: new Date(now - 4 * WEEK_MS),
    })
    .returning();
  await db.insert(clients).values({
    tag: "ActiveCo",
    displayName: "ActiveCo",
    recognized: true,
    lastActivityAt: new Date(now - 1 * WEEK_MS),
  });
  await db.insert(suggestions).values({
    category: "general",
    text: "A seed suggestion that should lose to the quiet client",
    active: true,
    lastPickedAt: null,
  });

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("client-quiet");
  expect(result.clientId).toBe(quietClient.id);
  expect(result.text).toContain("QuietCo");
});

test("picks the oldest-quiet client first when multiple clients qualify", async () => {
  const now = Date.now();
  await db.insert(clients).values({
    tag: "ModeratelyQuiet",
    displayName: "ModeratelyQuiet",
    recognized: true,
    lastActivityAt: new Date(now - 5 * WEEK_MS),
  });
  const [oldestQuiet] = await db
    .insert(clients)
    .values({
      tag: "VeryQuiet",
      displayName: "VeryQuiet",
      recognized: true,
      lastActivityAt: new Date(now - 10 * WEEK_MS),
    })
    .returning();

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("client-quiet");
  expect(result.clientId).toBe(oldestQuiet.id);
});

// I7 regression coverage: a client with lastActivityAt === null ("never
// had any activity yet") must never be treated as quiet, regardless of
// `recognized` — there's nothing to "go quiet" if nothing has happened
// yet. This used to be inverted (null sorted as the MOST quiet for a
// `recognized` client), which flooded day one: every freshly-seeded
// client starts with lastActivityAt null, so the quiet-client nudge would
// show "X has gone quiet" for one known tag after another — including
// ARC/Ulti, which read as Callum being told to check in with himself —
// crowding out the curated seed-suggestion rotation for weeks.

test("I7: does not treat a recognized client with no recorded activity at all as quiet", async () => {
  const now = Date.now();
  await db.insert(clients).values({
    tag: "NeverActive",
    displayName: "NeverActive",
    recognized: true,
    lastActivityAt: null,
  });
  await db.insert(suggestions).values({
    category: "general",
    text: "Fallback seed suggestion",
    active: true,
    lastPickedAt: null,
  });

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("seed");
});

test("does not treat an unrecognized client with no recorded activity as quiet", async () => {
  const now = Date.now();
  await db.insert(clients).values({
    tag: "UnknownTag",
    displayName: "UnknownTag",
    recognized: false,
    lastActivityAt: null,
  });
  await db.insert(suggestions).values({
    category: "general",
    text: "Fallback seed suggestion",
    active: true,
    lastPickedAt: null,
  });

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("seed");
});

test("I7: a newly-seeded roster (all 7 known tags, all lastActivityAt null) never floods the quiet-client nudge", async () => {
  // Simulates the exact day-one scenario from C1/I7: seedClients() has run,
  // so every known client tag exists with lastActivityAt null, and nothing
  // has uploaded yet. The seed-suggestion rotation must win, not a flood of
  // "X has gone quiet" for each tag in turn.
  const now = Date.now();
  const knownTags = ["Lovelots", "Lesamai", "That Place", "HappyFish", "NLD", "ARC", "Ulti"];
  await db.insert(clients).values(
    knownTags.map((tag) => ({
      tag,
      displayName: tag,
      recognized: true,
      lastActivityAt: null,
    })),
  );
  await db.insert(suggestions).values({
    category: "general",
    text: "Fallback seed suggestion",
    active: true,
    lastPickedAt: null,
  });

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("seed");
  expect(result.clientId).toBeUndefined();
});

test("I7: a client DOES still qualify as quiet once it has real activity that's then 3+ weeks old (including an ARC/Ulti-style tag)", async () => {
  const now = Date.now();
  const [arc] = await db
    .insert(clients)
    .values({
      tag: "ARC",
      displayName: "ARC",
      recognized: true,
      lastActivityAt: new Date(now - 4 * WEEK_MS),
    })
    .returning();

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("client-quiet");
  expect(result.clientId).toBe(arc.id);
});

test("returns a seed suggestion when all clients are recently active", async () => {
  const now = Date.now();
  await db.insert(clients).values({
    tag: "RecentlyActive",
    displayName: "RecentlyActive",
    recognized: true,
    lastActivityAt: new Date(now - 2 * DAY_MS),
  });
  await db.insert(suggestions).values([
    { category: "general", text: "Seed suggestion A", active: true, lastPickedAt: null },
    { category: "general", text: "Seed suggestion B", active: true, lastPickedAt: null },
  ]);

  const result = await pickSuggestion(new Date(now));

  expect(result.source).toBe("seed");
  expect(["Seed suggestion A", "Seed suggestion B"]).toContain(result.text);
  expect(result.clientId).toBeUndefined();
});

test("ignores inactive suggestions entirely, even when they'd otherwise be picked first", async () => {
  const now = Date.now();
  await db.insert(suggestions).values([
    { category: "general", text: "Inactive, never picked", active: false, lastPickedAt: null },
    {
      category: "general",
      text: "Active, picked a while ago",
      active: true,
      lastPickedAt: new Date(now - 1 * DAY_MS),
    },
  ]);

  const result = await pickSuggestion(new Date(now));

  expect(result.text).toBe("Active, picked a while ago");
});

test("round-robins through all active suggestions before repeating, nulls-first", async () => {
  const t0 = Date.now();
  await db.insert(suggestions).values([
    { category: "general", text: "S1", active: true, lastPickedAt: null },
    { category: "general", text: "S2", active: true, lastPickedAt: null },
    { category: "general", text: "S3", active: true, lastPickedAt: null },
  ]);

  const first = await pickSuggestion(new Date(t0));
  const second = await pickSuggestion(new Date(t0 + 1000));
  const third = await pickSuggestion(new Date(t0 + 2000));

  // All three must be shown before any repeats.
  expect(new Set([first.text, second.text, third.text])).toEqual(
    new Set(["S1", "S2", "S3"]),
  );

  // The fourth call repeats the earliest-picked suggestion, not a random one.
  const fourth = await pickSuggestion(new Date(t0 + 3000));
  expect(fourth.text).toBe(first.text);
});

test("a suggestion with an old (but non-null) lastPickedAt still loses to one never picked", async () => {
  const now = Date.now();
  await db.insert(suggestions).values([
    {
      category: "general",
      text: "Picked long ago",
      active: true,
      lastPickedAt: new Date(now - 100 * DAY_MS),
    },
    { category: "general", text: "Never picked", active: true, lastPickedAt: null },
  ]);

  const result = await pickSuggestion(new Date(now));

  expect(result.text).toBe("Never picked");
});

test("picking a suggestion updates its lastPickedAt in the DB to the given 'now'", async () => {
  const now = new Date();
  const [suggestion] = await db
    .insert(suggestions)
    .values({
      category: "general",
      text: "Track my lastPickedAt",
      active: true,
      lastPickedAt: null,
    })
    .returning();

  await pickSuggestion(now);

  const [updated] = await db.select().from(suggestions).where(eq(suggestions.id, suggestion.id));
  expect(updated.lastPickedAt?.getTime()).toBe(now.getTime());
});
