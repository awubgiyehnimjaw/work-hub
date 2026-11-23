import { and, eq, gt, gte, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { calendarEventsCache, postingScheduleCompletions, pushSubscriptions, syncState, tasks } from "@/lib/db/schema";
import { sendPush } from "@/lib/push/send";
import { formatLocalDateTime } from "@/lib/groq/client";
import { getOwnerChatId, sendMessage } from "@/lib/telegram/client";
import { sendNagMessage } from "@/lib/telegram/todo-messages";
import { isQuietHoursSgt, startOfTomorrowSgt } from "@/lib/reminders/sgt-time";
import {
  fetchPostingScheduleCsv,
  filterByNotCompleted,
  filterDueSoon,
  parsePostingScheduleCsv,
  sgtDateKey,
} from "@/lib/posting-schedule/sheet";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** `tasks` rows that aren't currently snoozed — same filter `lib/telegram/chat-tools.ts` uses. */
function notSnoozed(now: Date) {
  return or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now));
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

// Weekly digest fires in this UTC hour on Sundays — 10:00 UTC is 18:00
// Singapore time (UTC+8), the default "Sunday evening" slot. The
// reminder-check cron runs every 15 minutes, so this gives up to a
// 60-minute firing window; `weeklyDigestSentAt` (checked against
// SIX_DAYS_MS, not "this calendar week") is what actually guarantees at
// most one send regardless of how many ticks land inside that window.
const DIGEST_DAY_OF_WEEK = 0; // Sunday
const DIGEST_HOUR_UTC = 10;

const TWENTY_HOURS_MS = 20 * 60 * 60 * 1000;

// 01:00 UTC = 09:00 SGT — a "start of Callum's day" slot for the daily
// posting-schedule check, distinct from the weekly digest's Sunday-evening
// slot above.
const POSTING_SCHEDULE_CHECK_HOUR_UTC = 1;

/**
 * Sends a "this is due" push for every active to-do whose `dueAt` has
 * passed and hasn't been notified yet. Idempotent via `dueNotifiedAt`
 * (mirrors `lib/frameio/poll.ts`'s `snoozeNotifiedAt` pattern) — no
 * previous-cursor window needed, since a to-do's `dueAt` never changes
 * once set (unlike a task that can be re-snoozed to a new time), so
 * "not yet notified for this exact due date" is sufficient on its own.
 */
export async function checkDueTodos(now: Date): Promise<{ notified: number }> {
  const candidates = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.type, "todo"),
        eq(tasks.status, "active"),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, now),
        isNull(tasks.dueNotifiedAt),
      ),
    );

  if (candidates.length === 0) {
    return { notified: 0 };
  }

  const subscriptions = await db.select().from(pushSubscriptions);

  for (const task of candidates) {
    for (const subscription of subscriptions) {
      await sendPush(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        {
          title: "To-do due",
          body: task.title,
          url: "",
        },
      );
    }

    await db.update(tasks).set({ dueNotifiedAt: now }).where(eq(tasks.id, task.id));
  }

  return { notified: candidates.length };
}

const DAY_MS = 24 * 60 * 60 * 1000;

type DueSoonColumnKey = "dueOneDayNotifiedAt" | "dueThreeDayNotifiedAt" | "dueWeekAheadNotifiedAt";

// Each column has the exact same runtime shape (a nullable timestamp on
// `tasks`), but Drizzle's generated type for each one carries its own
// literal column name, so a single precise type can't cover all three —
// `PgColumn` (its own type parameter left to infer loosely) is the
// deliberately-widened type this map needs.
const dueSoonColumns: Record<DueSoonColumnKey, PgColumn> = {
  dueOneDayNotifiedAt: tasks.dueOneDayNotifiedAt,
  dueThreeDayNotifiedAt: tasks.dueThreeDayNotifiedAt,
  dueWeekAheadNotifiedAt: tasks.dueWeekAheadNotifiedAt,
};

interface DueSoonBand {
  label: string;
  // Time-until-due must fall in (minMs, maxMs] for this band — exclusive
  // lower bound, inclusive upper — so the three bands partition "not yet
  // due" time cleanly with no overlap and no gap.
  minMs: number;
  maxMs: number;
  columnKey: DueSoonColumnKey;
}

const DUE_SOON_BANDS: DueSoonBand[] = [
  { label: "Due tomorrow", minMs: 0, maxMs: DAY_MS, columnKey: "dueOneDayNotifiedAt" },
  { label: "Due in 3 days", minMs: DAY_MS, maxMs: 3 * DAY_MS, columnKey: "dueThreeDayNotifiedAt" },
  { label: "Due in 1 week", minMs: 3 * DAY_MS, maxMs: 7 * DAY_MS, columnKey: "dueWeekAheadNotifiedAt" },
];

async function checkDueSoonBand(now: Date, band: DueSoonBand): Promise<number> {
  const column = dueSoonColumns[band.columnKey];
  const lowerBound = new Date(now.getTime() + band.minMs);
  const upperBound = new Date(now.getTime() + band.maxMs);

  const candidates = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.type, "todo"),
        eq(tasks.status, "active"),
        isNotNull(tasks.dueAt),
        gt(tasks.dueAt, lowerBound),
        lte(tasks.dueAt, upperBound),
        isNull(column),
      ),
    );

  if (candidates.length === 0) {
    return 0;
  }

  const subscriptions = await db.select().from(pushSubscriptions);

  for (const task of candidates) {
    for (const subscription of subscriptions) {
      await sendPush(
        { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
        { title: band.label, body: task.title, url: "" },
      );
    }
    await db.update(tasks).set({ [band.columnKey]: now }).where(eq(tasks.id, task.id));
  }

  return candidates.length;
}

/**
 * Advance heads-up pushes for an upcoming to-do due date — due within 1
 * day, within 3 days, or within 1 week — each firing at most once per
 * to-do via its own `tasks.due*NotifiedAt` column. Bands are mutually
 * exclusive (checked against time-remaining-until-due, not a cumulative
 * "within N days" threshold), so a to-do created with 2 days left gets
 * exactly the "due in 3 days" heads-up once rather than also a misleading
 * "due in 1 week" notice on the same tick — and a to-do that exists long
 * enough naturally progresses through all three as each one's moment
 * arrives, same as `checkDueTodos` then covers the moment it's actually due.
 */
export async function checkUpcomingDueTodos(now: Date): Promise<{ notified: number }> {
  let total = 0;
  for (const band of DUE_SOON_BANDS) {
    total += await checkDueSoonBand(now, band);
  }
  return { notified: total };
}

async function getSyncStateRow() {
  const [existing] = await db.select().from(syncState);
  if (existing) {
    return existing;
  }
  const [created] = await db.insert(syncState).values({}).returning();
  return created;
}

function isInDigestWindow(now: Date): boolean {
  return now.getUTCDay() === DIGEST_DAY_OF_WEEK && now.getUTCHours() === DIGEST_HOUR_UTC;
}

/**
 * Sends a weekly "here's your week ahead" push summarizing upcoming
 * calendar events and pending review tasks, once per week, in the Sunday
 * 10:00 UTC (18:00 SGT) window. Content is drawn only from real counts —
 * never fabricated — so a quiet week just says so rather than inventing
 * something to report.
 */
export async function maybeSendWeeklyDigest(now: Date): Promise<{ sent: boolean }> {
  if (!isInDigestWindow(now)) {
    return { sent: false };
  }

  const state = await getSyncStateRow();
  const alreadySentThisWeek =
    state.weeklyDigestSentAt !== null &&
    now.getTime() - state.weeklyDigestSentAt.getTime() < SIX_DAYS_MS;
  if (alreadySentThisWeek) {
    return { sent: false };
  }

  const weekEnd = new Date(now.getTime() + SEVEN_DAYS_MS);

  const upcomingEvents = await db
    .select()
    .from(calendarEventsCache)
    .where(and(gte(calendarEventsCache.endAt, now), lte(calendarEventsCache.startAt, weekEnd)));

  const pendingReviews = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.type, "review"), eq(tasks.status, "active")));

  const eventWord = upcomingEvents.length === 1 ? "event" : "events";
  const reviewWord = pendingReviews.length === 1 ? "review" : "reviews";
  const body =
    upcomingEvents.length === 0 && pendingReviews.length === 0
      ? "Nothing on the calendar and no reviews waiting — a quiet week."
      : `${upcomingEvents.length} ${eventWord} this week, ${pendingReviews.length} ${reviewWord} waiting.`;

  const subscriptions = await db.select().from(pushSubscriptions);
  for (const subscription of subscriptions) {
    await sendPush(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      {
        title: "Your week ahead",
        body,
        url: "",
      },
    );
  }

  await db.update(syncState).set({ weeklyDigestSentAt: now }).where(eq(syncState.id, state.id));

  return { sent: true };
}

function isInPostingScheduleWindow(now: Date): boolean {
  return now.getUTCHours() === POSTING_SCHEDULE_CHECK_HOUR_UTC;
}

function describeDueDate(postDateKey: string, todayKey: string): string {
  const diffDays = Math.round(
    (Date.parse(`${postDateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / (24 * 60 * 60 * 1000),
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "overdue by 1 day";
  if (diffDays < 0) return `overdue by ${-diffDays} days`;
  return `in ${diffDays} days`;
}

/**
 * Sends a "what's due to post soon" push once a day, in the 09:00 SGT
 * window, listing every posting-schedule entry due within the next 3
 * days — and keeps listing an entry every day once it's overdue, until
 * Callum presses "Done" on it in the app (`postingScheduleCompletions`).
 * Silent (but still marks the day checked) when nothing is due —
 * unlike the weekly digest, a daily "nothing to post" push would just be
 * noise. `postingScheduleCheckedAt` is only updated on a successful
 * check (found something or not) — a fetch failure leaves it unset so
 * the next cron tick (15 minutes later, still inside the same window)
 * retries rather than silently skipping the whole day.
 */
export async function maybeSendPostingScheduleDigest(now: Date): Promise<{ sent: boolean }> {
  if (!isInPostingScheduleWindow(now)) {
    return { sent: false };
  }

  const state = await getSyncStateRow();
  const alreadyCheckedToday =
    state.postingScheduleCheckedAt !== null &&
    now.getTime() - state.postingScheduleCheckedAt.getTime() < TWENTY_HOURS_MS;
  if (alreadyCheckedToday) {
    return { sent: false };
  }

  let dueSoon;
  try {
    const csv = await fetchPostingScheduleCsv();
    dueSoon = filterDueSoon(parsePostingScheduleCsv(csv), now);
  } catch (error) {
    console.error("maybeSendPostingScheduleDigest: failed to fetch/parse the posting schedule", error);
    return { sent: false };
  }

  const completions = await db.select().from(postingScheduleCompletions);
  dueSoon = filterByNotCompleted(dueSoon, new Set(completions.map((row) => row.entryKey)));

  await db.update(syncState).set({ postingScheduleCheckedAt: now }).where(eq(syncState.id, state.id));

  if (dueSoon.length === 0) {
    return { sent: false };
  }

  const todayKey = sgtDateKey(now);
  const body = dueSoon
    .map((entry) => `${entry.client} — ${entry.video} (${describeDueDate(entry.postDate!, todayKey)})`)
    .join("; ");

  const subscriptions = await db.select().from(pushSubscriptions);
  for (const subscription of subscriptions) {
    await sendPush(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
      {
        title: "Posting schedule",
        body,
        url: "",
      },
    );
  }

  return { sent: true };
}

/**
 * Re-nags Callum on Telegram for every overdue, non-snoozed to-do, every 3
 * hours until he acts via one of the nag message's buttons — independent of
 * `dueNotifiedAt` (the one-shot web push above), tracked by its own
 * `telegramNagSentAt` column. Suppressed entirely during quiet hours
 * (11pm-8am SGT), without touching `telegramNagSentAt`, so the next nag
 * after quiet hours end isn't delayed by the skipped window.
 */
export async function checkOverdueTodoNags(now: Date): Promise<{ notified: number }> {
  if (isQuietHoursSgt(now)) {
    return { notified: 0 };
  }

  // Resolved before the query (not just before use) so a misconfigured
  // TELEGRAM_OWNER_CHAT_ID fails loudly on every tick rather than only
  // the ticks that happen to find an overdue to-do.
  const ownerChatId = getOwnerChatId();

  const renagCutoff = new Date(now.getTime() - THREE_HOURS_MS);
  const candidates = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.type, "todo"),
        eq(tasks.status, "active"),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, now),
        notSnoozed(now),
        or(isNull(tasks.telegramNagSentAt), lte(tasks.telegramNagSentAt, renagCutoff)),
      ),
    );

  for (const task of candidates) {
    await sendNagMessage(ownerChatId, task);
    await db.update(tasks).set({ telegramNagSentAt: now }).where(eq(tasks.id, task.id));
  }

  return { notified: candidates.length };
}

function dueLine(task: { title: string; dueAt: Date | null }): string {
  return task.dueAt ? `${task.title} (due ${formatLocalDateTime(task.dueAt)})` : task.title;
}

/**
 * Sends a "here's today" Telegram digest once a day, in the same 9am SGT
 * window `maybeSendPostingScheduleDigest` already checks
 * (`POSTING_SCHEDULE_CHECK_HOUR_UTC`) — overdue, due-today, and undated
 * active to-dos. Silent (but still marks the day checked) when all three
 * are empty, same "set it whether or not anything was sent" pattern as
 * `postingScheduleCheckedAt`.
 */
export async function maybeSendMorningDigest(now: Date): Promise<{ sent: boolean }> {
  if (!isInPostingScheduleWindow(now)) {
    return { sent: false };
  }

  const state = await getSyncStateRow();
  const alreadyCheckedToday =
    state.morningDigestSentAt !== null && now.getTime() - state.morningDigestSentAt.getTime() < TWENTY_HOURS_MS;
  if (alreadyCheckedToday) {
    return { sent: false };
  }

  const base = and(eq(tasks.type, "todo"), eq(tasks.status, "active"), notSnoozed(now));
  const tomorrowStart = startOfTomorrowSgt(now);

  const [overdue, dueToday, undated] = await Promise.all([
    db.select().from(tasks).where(and(base, isNotNull(tasks.dueAt), lte(tasks.dueAt, now))),
    db.select().from(tasks).where(and(base, isNotNull(tasks.dueAt), gt(tasks.dueAt, now), lt(tasks.dueAt, tomorrowStart))),
    db.select().from(tasks).where(and(base, isNull(tasks.dueAt))),
  ]);

  await db.update(syncState).set({ morningDigestSentAt: now }).where(eq(syncState.id, state.id));

  if (overdue.length === 0 && dueToday.length === 0 && undated.length === 0) {
    return { sent: false };
  }

  const lines = [
    ...overdue.map((task) => `Overdue: ${dueLine(task)}`),
    ...dueToday.map((task) => `Due today: ${dueLine(task)}`),
    ...undated.map((task) => `No date: ${task.title}`),
  ];
  await sendMessage(getOwnerChatId(), lines.join("\n"));

  return { sent: true };
}
