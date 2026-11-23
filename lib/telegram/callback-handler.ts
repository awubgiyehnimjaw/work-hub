import { completeTask } from "@/lib/tasks/complete";
import { dismissTask } from "@/lib/tasks/dismiss";
import { snoozeTask } from "@/lib/tasks/snooze";
import { tomorrowNineAmSgt } from "@/lib/reminders/sgt-time";
import { answerCallbackQuery, editMessageText } from "@/lib/telegram/client";

const ONE_HOUR_MS = 60 * 60 * 1000;

type TaskRow = { title: string } | null;

const ACTIONS: Record<string, (taskId: string, now: Date) => Promise<{ title: string } | null>> = {
  done: (taskId, now) => completeTask(taskId, now),
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
    await answerCallbackQuery(callbackQueryId);
    return;
  }

  const result: TaskRow = await apply(taskId, now);
  if (!result) {
    await editMessageText(chatId, messageId, "Couldn't find that to-do — it may already have been handled.", []);
  } else {
    await editMessageText(chatId, messageId, CONFIRMATIONS[action](result.title), []);
  }

  await answerCallbackQuery(callbackQueryId);
}
