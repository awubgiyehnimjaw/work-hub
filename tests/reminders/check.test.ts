import { beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendarEventsCache, postingScheduleCompletions, pushSubscriptions, syncState, tasks } from "@/lib/db/schema";
import { checkDueTodos, checkUpcomingDueTodos, maybeSendPostingScheduleDigest, maybeSendWeeklyDigest } from "@/lib/reminders/check";
import { sendPush } from "@/lib/push/send";
import { entryKey, fetchPostingScheduleCsv } from "@/lib/posting-schedule/sheet";

vi.mock("@/lib/push/send", () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/posting-schedule/sheet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/posting-schedule/sheet")>("@/lib/posting-schedule/sheet");
  return { ...actual, fetchPostingScheduleCsv: vi.fn() };
});

const sendPushMock = vi.mocked(sendPush);
const fetchPostingScheduleCsvMock = vi.mocked(fetchPostingScheduleCsv);

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(calendarEventsCache);
  await db.delete(syncState);
  await db.delete(pushSubscriptions);
  await db.delete(postingScheduleCompletions);
  sendPushMock.mockClear();
  fetchPostingScheduleCsvMock.mockReset();

  await db.insert(pushSubscriptions).values({
    endpoint: "https://push.example.com/sub-1",
    p256dh: "p256dh-key",
    auth: "auth-key",
  });
});

test("checkDueTodos notifies for a to-do whose due date has passed and hasn't been notified", async () => {
  const [task] = await db
    .insert(tasks)
    .values({
      type: "todo",
      title: "Send invoice",
      status: "active",
      dueAt: new Date(Date.now() - 60_000),
    })
    .returning();

  const result = await checkDueTodos(new Date());

  expect(result).toEqual({ notified: 1 });
  expect(sendPushMock).toHaveBeenCalledTimes(1);
  expect(sendPushMock.mock.calls[0][1]).toMatchObject({ title: "To-do due", body: "Send invoice" });

  const [row] = await db.select().from(tasks);
  expect(row.id).toBe(task.id);
  expect(row.dueNotifiedAt).not.toBeNull();
});

test("checkDueTodos does not notify for a to-do whose due date is still in the future", async () => {
  await db.insert(tasks).values({
    type: "todo",
    title: "Future thing",
    status: "active",
    dueAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  const result = await checkDueTodos(new Date());

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkDueTodos does not re-notify a to-do that was already notified", async () => {
  await db.insert(tasks).values({
    type: "todo",
    title: "Already notified",
    status: "active",
    dueAt: new Date(Date.now() - 60_000),
    dueNotifiedAt: new Date(Date.now() - 30_000),
  });

  const result = await checkDueTodos(new Date());

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkDueTodos ignores a completed to-do even with a past due date", async () => {
  await db.insert(tasks).values({
    type: "todo",
    title: "Done already",
    status: "completed",
    completedAt: new Date(),
    dueAt: new Date(Date.now() - 60_000),
  });

  const result = await checkDueTodos(new Date());

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkDueTodos ignores to-dos with no due date at all", async () => {
  await db.insert(tasks).values({ type: "todo", title: "No due date", status: "active" });

  const result = await checkDueTodos(new Date());

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

// Sunday 10:00 UTC — inside the digest window (lib/reminders/check.ts).
const SUNDAY_IN_WINDOW = new Date("2026-10-18T10:05:00.000Z");
// Monday — outside the window entirely.
const MONDAY_OUTSIDE_WINDOW = new Date("2026-10-19T10:05:00.000Z");

test("maybeSendWeeklyDigest does nothing outside the Sunday window", async () => {
  const result = await maybeSendWeeklyDigest(MONDAY_OUTSIDE_WINDOW);

  expect(result).toEqual({ sent: false });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("maybeSendWeeklyDigest sends a real-counts digest inside the window, first time", async () => {
  await db.insert(calendarEventsCache).values({
    googleEventId: "evt-1",
    title: "Filming (That Place)",
    startAt: new Date(SUNDAY_IN_WINDOW.getTime() + 24 * 60 * 60 * 1000),
    endAt: new Date(SUNDAY_IN_WINDOW.getTime() + 25 * 60 * 60 * 1000),
    allDay: false,
  });
  await db.insert(tasks).values([
    { type: "review", title: "Review — Lovelots", status: "active" },
    { type: "review", title: "Review — Lesamai", status: "active" },
  ]);

  const result = await maybeSendWeeklyDigest(SUNDAY_IN_WINDOW);

  expect(result).toEqual({ sent: true });
  expect(sendPushMock).toHaveBeenCalledTimes(1);
  const payload = sendPushMock.mock.calls[0][1];
  expect(payload.title).toBe("Your week ahead");
  expect(payload.body).toBe("1 event this week, 2 reviews waiting.");

  const [state] = await db.select().from(syncState);
  expect(state.weeklyDigestSentAt).not.toBeNull();
});

test("maybeSendWeeklyDigest reports a quiet week honestly when there's genuinely nothing", async () => {
  const result = await maybeSendWeeklyDigest(SUNDAY_IN_WINDOW);

  expect(result).toEqual({ sent: true });
  const payload = sendPushMock.mock.calls[0][1];
  expect(payload.body).toBe("Nothing on the calendar and no reviews waiting — a quiet week.");
});

test("maybeSendWeeklyDigest does not send twice within the same week even if called again inside the window", async () => {
  await maybeSendWeeklyDigest(SUNDAY_IN_WINDOW);
  sendPushMock.mockClear();

  const laterSameWindow = new Date(SUNDAY_IN_WINDOW.getTime() + 20 * 60 * 1000);
  const result = await maybeSendWeeklyDigest(laterSameWindow);

  expect(result).toEqual({ sent: false });
  expect(sendPushMock).not.toHaveBeenCalled();
});

// 01:00 UTC = 09:00 SGT — inside the posting-schedule daily check window.
const MORNING_IN_WINDOW = new Date("2026-10-16T01:05:00.000Z");
const AFTERNOON_OUTSIDE_WINDOW = new Date("2026-10-16T05:05:00.000Z");

const SAMPLE_CSV = [
  "Client,Video,Edit By,Post Date,Notes,Posted",
  "That Place,Creme Brulee Latte,15 Oct 2026,16 Oct 2026,,",
  "Lovelots,ranking (jewelry),16 Oct 2026,17 Oct 2026,,",
  "That Place,Bangers & Mash,16 Oct 2026,18 Oct 2026,,",
  "That Place,Montage,19 Oct 2026,20 Oct 2026,,",
].join("\n");

test("maybeSendPostingScheduleDigest does nothing outside the daily check window", async () => {
  const result = await maybeSendPostingScheduleDigest(AFTERNOON_OUTSIDE_WINDOW);

  expect(result).toEqual({ sent: false });
  expect(sendPushMock).not.toHaveBeenCalled();
  expect(fetchPostingScheduleCsvMock).not.toHaveBeenCalled();
});

test("maybeSendPostingScheduleDigest sends a push listing everything due within 3 days", async () => {
  fetchPostingScheduleCsvMock.mockResolvedValue(SAMPLE_CSV);

  const result = await maybeSendPostingScheduleDigest(MORNING_IN_WINDOW);

  expect(result).toEqual({ sent: true });
  expect(sendPushMock).toHaveBeenCalledTimes(1);
  const payload = sendPushMock.mock.calls[0][1];
  expect(payload.title).toBe("Posting schedule");
  expect(payload.body).toContain("That Place");
  expect(payload.body).toContain("Creme Brulee Latte");
  expect(payload.body).toContain("Lovelots");
  expect(payload.body).toContain("ranking (jewelry)");
  expect(payload.body).toContain("Bangers & Mash");
  expect(payload.body).not.toContain("Montage"); // 4 days out — outside the window

  const [state] = await db.select().from(syncState);
  expect(state.postingScheduleCheckedAt).not.toBeNull();
});

test("maybeSendPostingScheduleDigest keeps listing an overdue entry until it's marked done", async () => {
  fetchPostingScheduleCsvMock.mockResolvedValue(
    ["Client,Video,Edit By,Post Date,Notes,Posted", "That Place,Late Video,10 Oct 2026,10 Oct 2026,,"].join("\n"),
  );

  const result = await maybeSendPostingScheduleDigest(MORNING_IN_WINDOW);

  expect(result).toEqual({ sent: true });
  const body = sendPushMock.mock.calls[0][1].body;
  expect(body).toContain("Late Video");
  expect(body).toContain("overdue by 6 days");
});

test("maybeSendPostingScheduleDigest skips an entry already marked done via the Done button", async () => {
  fetchPostingScheduleCsvMock.mockResolvedValue(SAMPLE_CSV);
  await db.insert(postingScheduleCompletions).values({
    entryKey: entryKey({ client: "That Place", video: "Creme Brulee Latte", postDate: "2026-10-16" }),
  });

  const result = await maybeSendPostingScheduleDigest(MORNING_IN_WINDOW);

  expect(result).toEqual({ sent: true });
  expect(sendPushMock.mock.calls[0][1].body).not.toContain("Creme Brulee Latte");
});

test("maybeSendPostingScheduleDigest sends nothing, but still marks checked, when nothing is due soon", async () => {
  fetchPostingScheduleCsvMock.mockResolvedValue(
    ["Client,Video,Edit By,Post Date,Notes,Posted", "That Place,Montage,19 Oct 2026,20 Oct 2026,,"].join("\n"),
  );

  const result = await maybeSendPostingScheduleDigest(MORNING_IN_WINDOW);

  expect(result).toEqual({ sent: false });
  expect(sendPushMock).not.toHaveBeenCalled();

  const [state] = await db.select().from(syncState);
  expect(state.postingScheduleCheckedAt).not.toBeNull();
});

test("maybeSendPostingScheduleDigest does not re-check within the same day's window", async () => {
  fetchPostingScheduleCsvMock.mockResolvedValue(SAMPLE_CSV);
  await maybeSendPostingScheduleDigest(MORNING_IN_WINDOW);
  sendPushMock.mockClear();
  fetchPostingScheduleCsvMock.mockClear();

  const laterSameWindow = new Date(MORNING_IN_WINDOW.getTime() + 20 * 60 * 1000);
  const result = await maybeSendPostingScheduleDigest(laterSameWindow);

  expect(result).toEqual({ sent: false });
  expect(fetchPostingScheduleCsvMock).not.toHaveBeenCalled();
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("maybeSendPostingScheduleDigest leaves checkedAt unset on a fetch failure, so the next tick retries", async () => {
  fetchPostingScheduleCsvMock.mockRejectedValue(new Error("network error"));

  const result = await maybeSendPostingScheduleDigest(MORNING_IN_WINDOW);

  expect(result).toEqual({ sent: false });
  expect(sendPushMock).not.toHaveBeenCalled();

  const [state] = await db.select().from(syncState);
  expect(state?.postingScheduleCheckedAt ?? null).toBeNull();
});

const NOW_FOR_DUE_SOON = new Date("2026-10-18T04:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function insertTodoDueIn(ms: number) {
  const [task] = await db
    .insert(tasks)
    .values({
      type: "todo",
      title: "Send invoice",
      status: "active",
      dueAt: new Date(NOW_FOR_DUE_SOON.getTime() + ms),
    })
    .returning();
  return task;
}

test("checkUpcomingDueTodos sends the 1-day heads-up for a to-do due in 12 hours", async () => {
  await insertTodoDueIn(12 * HOUR_MS);

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 1 });
  expect(sendPushMock).toHaveBeenCalledTimes(1);
  expect(sendPushMock.mock.calls[0][1]).toMatchObject({ title: "Due tomorrow", body: "Send invoice" });
});

test("checkUpcomingDueTodos sends only the 3-day heads-up (not also week-ahead) for a to-do due in 2 days — bands are mutually exclusive", async () => {
  await insertTodoDueIn(2 * DAY_MS);

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 1 });
  expect(sendPushMock).toHaveBeenCalledTimes(1);
  expect(sendPushMock.mock.calls[0][1]).toMatchObject({ title: "Due in 3 days" });
});

test("checkUpcomingDueTodos sends the 1-week heads-up for a to-do due in 5 days", async () => {
  await insertTodoDueIn(5 * DAY_MS);

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 1 });
  expect(sendPushMock.mock.calls[0][1]).toMatchObject({ title: "Due in 1 week" });
});

test("checkUpcomingDueTodos sends nothing for a to-do due in 10 days — outside every band", async () => {
  await insertTodoDueIn(10 * DAY_MS);

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkUpcomingDueTodos sends nothing for a to-do that's already overdue", async () => {
  await insertTodoDueIn(-HOUR_MS);

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkUpcomingDueTodos does not re-send a band that already fired", async () => {
  const task = await insertTodoDueIn(12 * HOUR_MS);
  await db.update(tasks).set({ dueOneDayNotifiedAt: NOW_FOR_DUE_SOON }).where(eq(tasks.id, task.id));

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkUpcomingDueTodos ignores a to-do with no due date", async () => {
  await db.insert(tasks).values({ type: "todo", title: "No due date", status: "active" });

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkUpcomingDueTodos ignores a completed to-do even if its due date is in a band", async () => {
  await db.insert(tasks).values({
    type: "todo",
    title: "Already done",
    status: "completed",
    completedAt: NOW_FOR_DUE_SOON,
    dueAt: new Date(NOW_FOR_DUE_SOON.getTime() + 12 * HOUR_MS),
  });

  const result = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);

  expect(result).toEqual({ notified: 0 });
  expect(sendPushMock).not.toHaveBeenCalled();
});

test("checkUpcomingDueTodos fires the 3-day band, then later the 1-day band, for the same to-do as time passes", async () => {
  const task = await insertTodoDueIn(2 * DAY_MS); // created 2 days before due

  const first = await checkUpcomingDueTodos(NOW_FOR_DUE_SOON);
  expect(first).toEqual({ notified: 1 });
  sendPushMock.mockClear();

  const oneDayLater = new Date(NOW_FOR_DUE_SOON.getTime() + DAY_MS + HOUR_MS); // now ~23h from due
  const second = await checkUpcomingDueTodos(oneDayLater);

  expect(second).toEqual({ notified: 1 });
  expect(sendPushMock.mock.calls[0][1]).toMatchObject({ title: "Due tomorrow" });

  const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(row.dueThreeDayNotifiedAt).not.toBeNull();
  expect(row.dueOneDayNotifiedAt).not.toBeNull();
});
