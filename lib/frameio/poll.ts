import { and, eq, gt, ilike, isNotNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, pushSubscriptions, syncState, tasks } from "@/lib/db/schema";
import { seedClients, seedSuggestions } from "@/lib/db/seed";
import { buildFrameioUrl, listNewFiles, type FrameioFile } from "@/lib/frameio/client";
import { parseClientTag } from "@/lib/frameio/parse-client-tag";
import { sendPush } from "@/lib/push/send";

type ClientRow = typeof clients.$inferSelect;

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// Subtracted from the run's start time before it's stored as the next
// cursor, to absorb clock skew between Frame.io's server and ours. This is
// free: re-seeing a file inside the overlap just costs one extra SELECT in
// `alreadyRecorded` that finds it already exists (dedup is keyed on
// `frameioFileId`, not on time).
const CURSOR_OVERLAP_BUFFER_MS = 60 * 1000;

// Tag used for the single shared "catch-all" client row that files with no
// bracketed tag at all get attached to, so repeated untagged uploads don't
// each spawn their own client row. A real client tag can never collide
// with this (`parseClientTag` only ever returns bracket contents or null).
const NO_TAG_PLACEHOLDER = "Unrecognized";

async function getSinceISO(): Promise<string> {
  const [row] = await db.select().from(syncState);
  if (row?.frameioLastPolledAt) {
    return row.frameioLastPolledAt.toISOString();
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
}

async function markPolled(at: Date): Promise<void> {
  const [existing] = await db.select().from(syncState);
  if (existing) {
    await db
      .update(syncState)
      .set({ frameioLastPolledAt: at })
      .where(eq(syncState.id, existing.id));
  } else {
    await db.insert(syncState).values({ frameioLastPolledAt: at });
  }
}

/**
 * Looks up the `clients` row for a parsed tag, or creates one flagged
 * `recognized: false` if nothing matches — including when `tag` is `null`
 * (no bracket group in the filename at all). Never hardcodes the known
 * tag list; "known" means "already a row in `clients`" (seeded by Task 2's
 * `seedClients()`), queried fresh each time so a newly-recognized client
 * added to that table later is picked up automatically.
 */
async function getOrCreateClient(tag: string | null): Promise<ClientRow> {
  const effectiveTag = tag && tag.length > 0 ? tag : NO_TAG_PLACEHOLDER;

  // Case-insensitive: an editor typing "that place" should match the
  // seeded "That Place" row, not spawn a second "unrecognized" client.
  const [existing] = await db
    .select()
    .from(clients)
    .where(ilike(clients.tag, effectiveTag));
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(clients)
    .values({
      tag: effectiveTag,
      displayName: effectiveTag,
      recognized: false,
      lastActivityAt: null,
    })
    .onConflictDoNothing({ target: clients.tag })
    .returning();
  if (created) {
    return created;
  }

  // Lost a race to a concurrent poll run creating the same new tag —
  // re-read what's there now rather than erroring.
  const [raceWinner] = await db
    .select()
    .from(clients)
    .where(ilike(clients.tag, effectiveTag));
  if (!raceWinner) {
    throw new Error(`Failed to find or create client for tag "${effectiveTag}"`);
  }
  return raceWinner;
}

async function alreadyRecorded(frameioFileId: string): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.frameioFileId, frameioFileId));
  return existing !== undefined;
}

async function createReviewTask(
  file: FrameioFile,
  client: ClientRow,
): Promise<boolean> {
  const frameioUrl = file.viewUrl ?? buildFrameioUrl(file.id);

  // App-level dedup (`alreadyRecorded`, checked by the caller) is the
  // primary guard, but `onConflictDoNothing` on the DB's unique
  // `frameioFileId` constraint backs it up — e.g. the same file appearing
  // twice within one `listNewFiles` batch (pagination overlap) would
  // otherwise race both inserts past the app-level check. Without this,
  // the second insert's unique-constraint violation would throw and
  // abort the whole poll run instead of just skipping that one file.
  const [task] = await db
    .insert(tasks)
    .values({
      type: "review",
      title: `Review — ${client.displayName}`,
      clientId: client.id,
      frameioFileId: file.id,
      frameioUrl,
      sourceFileName: file.name,
      status: "active",
    })
    .onConflictDoNothing({ target: tasks.frameioFileId })
    .returning();

  if (!task) {
    // Someone else recorded this file first (race); nothing more to do.
    return false;
  }

  await db
    .update(clients)
    .set({ lastActivityAt: new Date() })
    .where(eq(clients.id, client.id));

  const subscriptions = await db.select().from(pushSubscriptions);
  for (const subscription of subscriptions) {
    await sendPush(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      {
        title: `New review: ${client.displayName}`,
        body: file.name,
        url: task.frameioUrl ?? frameioUrl,
      },
    );
  }

  return true;
}

/**
 * Important 4: the spec says a snoozed review task "reappears (with a
 * fresh notification) once that time passes" — but nothing previously
 * re-notified when a snooze expired; `sendPush` was only ever called from
 * `createReviewTask` on first discovery. This re-notifies for exactly the
 * snoozes that expired since the last poll cursor (`previousCursor` to
 * `now`), so each expiry gets exactly one notification regardless of how
 * many poll runs happen afterward while the task sits unactioned.
 *
 * Idempotent via `snoozeNotifiedAt`: a task is only notified if that
 * column is null or still older than its CURRENT `snoozedUntil` — so
 * re-snoozing the same task to a new future time correctly earns it
 * another notification when that new snooze also expires, without
 * re-notifying for the same expiry on every subsequent poll.
 */
async function notifyExpiredSnoozes(previousCursorISO: string, now: Date): Promise<void> {
  const previousCursor = new Date(previousCursorISO);

  const candidates = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.type, "review"),
        eq(tasks.status, "active"),
        isNotNull(tasks.snoozedUntil),
        gt(tasks.snoozedUntil, previousCursor),
        lte(tasks.snoozedUntil, now),
      ),
    );

  if (candidates.length === 0) {
    return;
  }

  const subscriptions = await db.select().from(pushSubscriptions);

  for (const task of candidates) {
    const snoozedUntil = task.snoozedUntil;
    if (!snoozedUntil) {
      continue;
    }
    const alreadyNotifiedForThisSnooze =
      task.snoozeNotifiedAt !== null && task.snoozeNotifiedAt.getTime() >= snoozedUntil.getTime();
    if (alreadyNotifiedForThisSnooze) {
      continue;
    }

    for (const subscription of subscriptions) {
      await sendPush(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        {
          title: "Review reminder",
          body: task.title,
          url: task.frameioUrl ?? "",
        },
      );
    }

    await db
      .update(tasks)
      .set({ snoozeNotifiedAt: snoozedUntil })
      .where(eq(tasks.id, task.id));
  }
}

/**
 * Polls Frame.io for files uploaded since the last poll and turns each one
 * into a review task. Every file produces a task — an unrecognized or
 * missing client tag is flagged (`clients.recognized = false`), never
 * silently dropped. Already-recorded files (by `frameioFileId`) are
 * skipped, not re-created.
 */
export interface FrameioPollResult {
  created: number;
  unrecognized: number;
  /**
   * Set (to `true`) only when `listNewFiles` itself threw (e.g. a 429
   * rate-limit or 5xx from Frame.io) — isolated here (Important 3) so that
   * failure can't crash the whole poll run the way it previously would
   * have, the same way a single bad file's failure is already isolated
   * below. Omitted entirely on a normal run, so existing callers that
   * `toEqual({ created, unrecognized })` are unaffected.
   */
  failed?: boolean;
}

export async function runFrameioPoll(): Promise<FrameioPollResult> {
  // Defense in depth for C1: production's `clients`/`suggestions` tables
  // should already be seeded via `npm run db:seed` (see
  // docs/superpowers/deploy-notes.md §4.1), but that's a manual step that's
  // easy to forget on a first deploy — and the consequences are severe
  // (empty `suggestions` makes `/api/suggestions` throw; an unseeded
  // `clients` table permanently mis-flags the first real upload per client
  // as unrecognized). Both seed functions are idempotent
  // (`onConflictDoNothing`), so calling them on every poll run is cheap and
  // self-heals a skipped manual step within one scheduled poll cycle.
  await seedClients();
  await seedSuggestions();

  // Captured BEFORE listNewFiles runs, not after this function finishes.
  // Stamping the cursor with a finish time would create a permanent blind
  // spot: a file created on Frame.io while this run is still fetching
  // folders / inserting rows / sending pushes would be excluded from both
  // this run's already-fetched results AND the next run's `createdAt >
  // sinceISO` filter (since the cursor would have already moved past it).
  const pollStartedAt = new Date();

  const sinceISO = await getSinceISO();

  // Important 4: checked independently of whether listNewFiles below
  // succeeds — a Frame.io API hiccup shouldn't also delay snooze-expiry
  // notifications, and it's safe either way: the cursor only advances on
  // a fully successful run, so a skipped check here just gets picked up
  // by the next run's wider (not-yet-advanced-cursor) window.
  try {
    await notifyExpiredSnoozes(sinceISO, pollStartedAt);
  } catch (error) {
    console.error("runFrameioPoll: failed to notify expired snoozes", error);
  }

  let files: FrameioFile[];
  let truncated: boolean;
  try {
    const listResult = await listNewFiles(sinceISO);
    files = listResult.files;
    truncated = listResult.truncated;
  } catch (error) {
    // Important 3: a thrown listNewFiles (429 rate-limit, 5xx, network
    // error, a bad FRAMEIO_PROJECT_ID, etc.) used to propagate straight out
    // of runFrameioPoll, crashing the entire run — including the per-file
    // processing below that already isolates its own failures. Isolating
    // it here instead means one bad poll against Frame.io's API behaves
    // exactly like a truncated traversal: nothing was actually looked at,
    // so the cursor must not advance, and the next scheduled run retries
    // from the same `sinceISO` cleanly.
    console.error(
      "runFrameioPoll: listNewFiles failed; not advancing the poll cursor so this run is retried next time",
      error,
    );
    return { created: 0, unrecognized: 0, failed: true };
  }

  let created = 0;
  let unrecognized = 0;
  let anyFailures = false;

  for (const file of files) {
    try {
      if (await alreadyRecorded(file.id)) {
        continue;
      }

      const tag = parseClientTag(file.name);
      const client = await getOrCreateClient(tag);

      const wasCreated = await createReviewTask(file, client);
      if (wasCreated) {
        created++;
        if (!client.recognized) {
          unrecognized++;
        }
      }
    } catch (error) {
      // Never let one bad file take down the whole poll run — log and
      // keep going so the rest of this batch still gets processed. But
      // don't advance the cursor past it either (see below): a file that
      // failed here (e.g. a transient DB error) must be retried next run,
      // not silently skipped forever.
      anyFailures = true;
      console.error(`runFrameioPoll: failed to process file ${file.id}`, error);
    }
  }

  if (anyFailures) {
    console.warn(
      "runFrameioPoll: at least one file failed to process this run; not advancing " +
        "the poll cursor so the whole batch is retried next run (dedup makes already-" +
        "succeeded files in it free to re-see).",
    );
  } else if (truncated) {
    console.warn(
      "runFrameioPoll: Frame.io folder traversal was truncated this run (hit a safety " +
        "cap); not advancing the poll cursor so the untraversed folders are retried next run.",
    );
  } else {
    await markPolled(new Date(pollStartedAt.getTime() - CURSOR_OVERLAP_BUFFER_MS));
  }

  return { created, unrecognized };
}
