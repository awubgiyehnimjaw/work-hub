import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { completeTask } from "@/lib/tasks/complete";
import { dismissTask } from "@/lib/tasks/dismiss";
import { snoozeTask } from "@/lib/tasks/snooze";
import { tomorrowNineAmSgt } from "@/lib/reminders/sgt-time";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram/client";

const ONE_HOUR_MS = 60 * 60 * 1000;

type TaskRow = { title: string } | null;

/**
 * `completeTask` (shared with the AI-chat tools) completes whatever task
 * its id points to regardless of current status, so — exactly like
 * `lib/telegram/chat-tools.ts`'s `markTodoDone` checks `type` first — the
 * current status is checked here before calling it, so a stale Done press
 * on an already-completed/dismissed to-do is a no-op, not an overwrite.
 */
async function applyDone(taskId: string, now: Date): Promise<{ title: string } | null> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.status !== "active") {
    return null;
  }
  return completeTask(taskId, now);
}

const ACTIONS: Record<string, (taskId: string, now: Date) => Promise<{ title: string } | null>> = {
  done: applyDone,
  snooze1h: (taskId, now) => snoozeTask(taskId, new Date(now.getTime() + ONE_HOUR_MS)),
  tomorrow: (taskId, now) => snoozeTask(taskId, tomorrowNineAmSgt(now)),
  drop: (taskId) => dismissTask(taskId),
};

const CONFIRMATIONS: Record<string, (title: string) => string> = {
  done: (title) => `✅ Done — ${title}`,
  snooze1h: () => "⏰ Snoozed 1 hour.",
  tomorrow: () => "📅 Snoozed to tomorrow 9am.",
  drop: () => "🗑 Dropped.",
};

/**
 * Handles one Telegram inline-button press from a nag/sweep message:
 * parses `td|<action>|<taskId>`, applies the action, edits the original
 * message to show the outcome (clearing its buttons), and answers the
 * callback so Telegram clears the tap's loading spinner. Never throws for
 * an unknown action or a stale/missing task id — both are reported back
 * to Callum via the edited message instead.
 */
export async function handleCallbackQuery(
  chatId: number,
  messageId: number,
  callbackQueryId: string,
  data: string,
  now: Date,
): Promise<void> {
  const [prefix, action, taskId] = data.split("|");
  const apply = prefix === "td" ? ACTIONS[action] : undefined;

  if (!apply) {
    console.warn(`telegram callback handler: unrecognized callback_data "${data}"`);
    await answerCallbackQuery(callbackQueryId);
    return;
  }

  // Wrapped so a malformed task id (an invalid UUID throws a DB error) or
  // a `editMessageText` failure (e.g. Telegram's "message is not
  // modified" on a double-tap race) still clears the button's loading
  // spinner instead of leaving it stuck — final-review Minor.
  try {
    const result: TaskRow = await apply(taskId, now);
    if (!result) {
      await editMessageText(chatId, messageId, "Couldn't find that to-do — it may already have been handled.", []);
    } else {
      await editMessageText(chatId, messageId, CONFIRMATIONS[action](result.title), []);
    }
  } catch (error) {
    console.error("telegram callback handler: failed to apply the action", error);
  } finally {
    await answerCallbackQuery(callbackQueryId);
  }
}
