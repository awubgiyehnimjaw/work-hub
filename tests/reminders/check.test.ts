import { beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { calendarEventsCache, pushSubscriptions, syncState, tasks } from "@/lib/db/schema";
import { checkDueTodos, maybeSendWeeklyDigest } from "@/lib/reminders/check";
import { sendPush } from "@/lib/push/send";

vi.mock("@/lib/push/send", () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));

const sendPushMock = vi.mocked(sendPush);

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(calendarEventsCache);
  await db.delete(syncState);
  await db.delete(pushSubscriptions);
  sendPushMock.mockClear();

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
