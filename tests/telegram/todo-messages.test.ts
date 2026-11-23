import { expect, test, vi } from "vitest";
import { sendMessage } from "@/lib/telegram/client";
import { sendNagMessage } from "@/lib/telegram/todo-messages";

vi.mock("@/lib/telegram/client", () => ({ sendMessage: vi.fn().mockResolvedValue(undefined) }));

test("sendNagMessage sends the title and three action buttons", async () => {
  await sendNagMessage(123, { id: "task-1", title: "Call the client", dueAt: new Date("2026-01-01T06:00:00Z") });
  const [chatId, text, buttons] = vi.mocked(sendMessage).mock.calls[0];
  expect(chatId).toBe(123);
  expect(text).toContain("Call the client");
  expect(buttons).toEqual([[
    { text: "✅ Done", callback_data: "td|done|task-1" },
    { text: "⏰ Snooze 1h", callback_data: "td|snooze1h|task-1" },
    { text: "📅 Tomorrow 9am", callback_data: "td|tomorrow|task-1" },
  ]]);
});
