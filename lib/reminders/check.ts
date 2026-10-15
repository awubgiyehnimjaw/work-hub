import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendarEventsCache, pushSubscriptions, syncState, tasks } from "@/lib/db/schema";
import { sendPush } from "@/lib/push/send";

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
