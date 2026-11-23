import { formatLocalDateTime } from "@/lib/groq/client";
import { sendMessage, type InlineKeyboard } from "@/lib/telegram/client";

export interface TodoMessageTask {
  id: string;
  title: string;
  dueAt: Date | null;
}

function dueSuffix(dueAt: Date | null): string {
  return dueAt ? ` (due ${formatLocalDateTime(dueAt)})` : "";
}

/** Re-sent every 3 hours by `checkOverdueTodoNags` until one of its buttons is pressed. */
export async function sendNagMessage(chatId: number, task: TodoMessageTask): Promise<void> {
  const keyboard: InlineKeyboard = [[
    { text: "✅ Done", callback_data: `td|done|${task.id}` },
    { text: "⏰ Snooze 1h", callback_data: `td|snooze1h|${task.id}` },
    { text: "📅 Tomorrow 9am", callback_data: `td|tomorrow|${task.id}` },
  ]];
  await sendMessage(chatId, `⏰ Overdue: ${task.title}${dueSuffix(task.dueAt)}`, keyboard);
}
