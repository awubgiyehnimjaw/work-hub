import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendarEventsCache, clients, contentIdeas, postingScheduleCompletions, tasks } from "@/lib/db/schema";
import { completePostingScheduleEntry } from "@/lib/posting-schedule/complete";
import {
  classifyPostingScheduleStatus,
  entryKey,
  fetchPostingScheduleCsv,
  filterByNotCompleted,
  filterDueSoon,
  parsePostingScheduleCsv,
  sgtDateKey,
} from "@/lib/posting-schedule/sheet";
import { completeTask } from "@/lib/tasks/complete";

const CALENDAR_WITHIN_DAYS = 14;

/** `tasks` rows that aren't currently snoozed into the future — same filter `GET /api/tasks` uses by default. */
function notSnoozed(now: Date) {
  return or(isNull(tasks.snoozedUntil), lte(tasks.snoozedUntil, now));
}

export interface ChatTodo {
  id: string;
  title: string;
  dueAt: string | null;
}

/** Active, non-snoozed to-dos — grounds the chat agent's answers about Callum's to-do list. */
export async function listActiveTodos(now: Date): Promise<ChatTodo[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.type, "todo"), eq(tasks.status, "active"), notSnoozed(now)));

  return rows.map((task) => ({
    id: task.id,
    title: task.title,
    dueAt: task.dueAt ? task.dueAt.toISOString() : null,
  }));
}

export interface ChatReview {
  id: string;
  title: string;
  clientName: string | null;
}

/** Active, non-snoozed Frame.io review tasks — grounds answers about pending reviews. */
export async function listActiveReviews(now: Date): Promise<ChatReview[]> {
  const rows = await db
    .select({ task: tasks, clientName: clients.displayName })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(and(eq(tasks.type, "review"), eq(tasks.status, "active"), notSnoozed(now)));

  return rows.map(({ task, clientName }) => ({
    id: task.id,
    title: task.title,
    clientName: clientName ?? null,
  }));
}

export interface ChatPostingScheduleEntry {
  entryKey: string;
  client: string;
  video: string;
  postDate: string | null;
  status: "none" | "green" | "red";
}

/** Posting-schedule entries due within 3 days (or overdue), excluding anything already marked done — same pipeline as `GET /api/posting-schedule/due-soon`. */
export async function listDueSoonPostingScheduleEntries(now: Date): Promise<ChatPostingScheduleEntry[]> {
  const csv = await fetchPostingScheduleCsv();
  let entries = filterDueSoon(parsePostingScheduleCsv(csv), now);

  const completions = await db.select().from(postingScheduleCompletions);
  const completedKeys = new Set(completions.map((row) => row.entryKey));
  entries = filterByNotCompleted(entries, completedKeys);

  const todayKey = sgtDateKey(now);
  return entries.map((entry) => ({
    ...entry,
    entryKey: entryKey(entry),
    status: entry.postDate ? classifyPostingScheduleStatus(entry.postDate, todayKey) : "none",
  }));
}

export interface ChatCalendarEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
}

/** Calendar events in the next 14 days (including one currently in progress) — same bound as `GET /api/calendar`. */
export async function listUpcomingCalendarEvents(now: Date): Promise<ChatCalendarEvent[]> {
  const horizon = new Date(now.getTime() + CALENDAR_WITHIN_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(calendarEventsCache)
    .where(and(gte(calendarEventsCache.endAt, now), lte(calendarEventsCache.startAt, horizon)))
    .orderBy(asc(calendarEventsCache.startAt));

  return rows.map((event) => ({
    id: event.id,
    title: event.title,
    startAt: event.startAt.toISOString(),
    endAt: event.endAt.toISOString(),
  }));
}

export interface ChatContentIdea {
  id: string;
  clientName: string | null;
  text: string;
}

/** Content ideas, optionally filtered to one client — grounds answers about logged content ideas. */
export async function listContentIdeas(clientId: string | null): Promise<ChatContentIdea[]> {
  const rows = await db
    .select({
      id: contentIdeas.id,
      text: contentIdeas.text,
      clientName: clients.displayName,
    })
    .from(contentIdeas)
    .leftJoin(clients, eq(contentIdeas.clientId, clients.id))
    .where(clientId ? eq(contentIdeas.clientId, clientId) : undefined);

  return rows.map((row) => ({ ...row, clientName: row.clientName ?? null }));
}

/**
 * Marks a to-do done via `completeTask`; false (no-op, no DB write at all)
 * for an unknown id or an id that isn't a todo — the type is checked
 * *before* calling `completeTask`, since that function completes whatever
 * task the id points to regardless of type.
 */
export async function markTodoDone(id: string, now: Date): Promise<boolean> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task || task.type !== "todo") {
    return false;
  }
  const updated = await completeTask(id, now);
  return updated !== null;
}

/** Same shape as `markTodoDone`, requiring `type === "review"`. */
export async function markReviewDone(id: string, now: Date): Promise<boolean> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task || task.type !== "review") {
    return false;
  }
  const updated = await completeTask(id, now);
  return updated !== null;
}

/**
 * Marks a posting-schedule sheet row done via `completePostingScheduleEntry`
 * — but only after confirming `targetEntryKey` actually matches a row in
 * the live sheet. The sheet has no id column, so a slightly-wrong key
 * from the model would otherwise insert a junk completion row while
 * sending a "done" confirmation and leaving the real entry outstanding.
 * Returns false, with no DB write, for a key matching nothing in the sheet.
 */
export async function markPostingScheduleEntryDone(targetEntryKey: string): Promise<boolean> {
  const csv = await fetchPostingScheduleCsv();
  const entries = parsePostingScheduleCsv(csv);
  const matches = entries.some((entry) => entryKey(entry) === targetEntryKey);
  if (!matches) {
    return false;
  }
  await completePostingScheduleEntry(targetEntryKey);
  return true;
}
