/**
 * Picks what Callum should look at when he has nothing urgent queued.
 *
 * A client that's gone quiet always outranks the idle-time seed list — if
 * someone needs a check-in, that's never a worse use of downtime than a
 * generic suggestion. Only when no client qualifies does this fall back to
 * rotating through the active `suggestions` rows, round-robin by
 * `lastPickedAt` so every suggestion surfaces before any of them repeat.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, suggestions } from "@/lib/db/schema";

const QUIET_THRESHOLD_MS = 21 * 24 * 60 * 60 * 1000; // 3 weeks

export interface PickedSuggestion {
  text: string;
  source: "seed" | "client-quiet";
  clientId?: string;
}

interface QuietCheckClient {
  id: string;
  displayName: string;
  recognized: boolean;
  lastActivityAt: Date | null;
}

/**
 * A client counts as "gone quiet" once its last recorded activity is more
 * than 3 weeks old. Important 7's fix: a client with NO recorded activity
 * at all (`lastActivityAt === null`) is never quiet, full stop — there's
 * nothing to "go quiet" if nothing has happened yet.
 *
 * This used to treat a `null` `lastActivityAt` as quiet (in fact as the
 * MOST quiet, since `byOldestActivityFirst` below sorts `null` as oldest)
 * for any `recognized` client. That flooded day one: every freshly-seeded
 * client starts with `lastActivityAt = null`, so the quiet-client nudge
 * would show "X has gone quiet" for each of the 7 known tags in turn —
 * including ARC and Ulti, which aren't real external clients, so being
 * told they'd "gone quiet" read as Callum being told to check in with
 * himself — crowding out the curated seed-suggestion rotation for
 * potentially weeks until every client got its first real upload. Once a
 * client DOES get activity and then goes quiet for 3+ weeks, that's a
 * perfectly reasonable nudge (including for ARC/Ulti — "go plan agency
 * content" / "make personal content" is a fine thing to be nudged about),
 * so only the null case changes here.
 */
function isClientQuiet(client: QuietCheckClient, now: Date): boolean {
  if (client.lastActivityAt === null) {
    return false;
  }
  return now.getTime() - client.lastActivityAt.getTime() > QUIET_THRESHOLD_MS;
}

/**
 * Orders by `lastActivityAt` ascending, treating `null` ("never active") as
 * older than any real timestamp — a client that's never shown activity is
 * at least as overdue for a check-in as one with an old timestamp.
 */
function byOldestActivityFirst(a: QuietCheckClient, b: QuietCheckClient): number {
  const aTime = a.lastActivityAt ? a.lastActivityAt.getTime() : -Infinity;
  const bTime = b.lastActivityAt ? b.lastActivityAt.getTime() : -Infinity;
  return aTime - bTime;
}

/**
 * Orders by `lastPickedAt` ascending, nulls first — a suggestion never
 * shown before always outranks one shown at any point in the past, which
 * is what guarantees every suggestion surfaces once before any repeat.
 */
function byOldestPickedFirst(
  a: { lastPickedAt: Date | null },
  b: { lastPickedAt: Date | null },
): number {
  const aTime = a.lastPickedAt ? a.lastPickedAt.getTime() : -Infinity;
  const bTime = b.lastPickedAt ? b.lastPickedAt.getTime() : -Infinity;
  return aTime - bTime;
}

export async function pickSuggestion(now: Date): Promise<PickedSuggestion> {
  const allClients = await db.select().from(clients);
  const quietClients = allClients
    .filter((client) => isClientQuiet(client, now))
    .sort(byOldestActivityFirst);

  if (quietClients.length > 0) {
    const client = quietClients[0];
    return {
      text: `${client.displayName} has gone quiet — worth a check-in?`,
      source: "client-quiet",
      clientId: client.id,
    };
  }

  const activeSuggestions = await db
    .select()
    .from(suggestions)
    .where(eq(suggestions.active, true));

  if (activeSuggestions.length === 0) {
    throw new Error("No active suggestions available to pick from");
  }

  const [picked] = activeSuggestions.sort(byOldestPickedFirst);

  await db.update(suggestions).set({ lastPickedAt: now }).where(eq(suggestions.id, picked.id));

  return { text: picked.text, source: "seed" };
}
