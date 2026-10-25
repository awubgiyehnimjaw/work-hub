import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { db } from "@/lib/db/client";
import { conversationMessages, tasks } from "@/lib/db/schema";

beforeAll(() => {
  process.env.GROQ_API_KEY = "test-groq-key";
});

vi.mock("@/lib/telegram/client", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/posting-schedule/sheet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/posting-schedule/sheet")>("@/lib/posting-schedule/sheet");
  return { ...actual, fetchPostingScheduleCsv: vi.fn() };
});

import { sendMessage } from "@/lib/telegram/client";
import { appendMessage, getRecentMessages } from "@/lib/telegram/conversation-memory";
import { handleChatMessage } from "@/lib/telegram/chat-handler";
import { fetchPostingScheduleCsv } from "@/lib/posting-schedule/sheet";

const mockSendMessage = vi.mocked(sendMessage);
const mockFetchPostingScheduleCsv = vi.mocked(fetchPostingScheduleCsv);
const CHAT_ID = 999;

beforeEach(async () => {
  mockSendMessage.mockClear().mockResolvedValue(undefined);
  mockFetchPostingScheduleCsv.mockReset();
  vi.unstubAllGlobals();
  await db.delete(tasks);
  await db.delete(conversationMessages);
});

test("a plain question with no matching tool gets answered directly and logged both ways", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "The capital of France is Paris." } }],
  }), { status: 200 })));
  await handleChatMessage(CHAT_ID, "what's the capital of France?", new Date("2026-01-01T00:00:00Z"));
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "The capital of France is Paris.");
  const rows = await getRecentMessages(CHAT_ID, 10);
  expect(rows.map((r) => r.content)).toEqual(["what's the capital of France?", "The capital of France is Paris."]);
});

test("a data question triggers a read tool call and the final reply is sent", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "list_active_todos", arguments: "{}" } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "You have 1 to-do: call the client." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await db.insert(tasks).values({ type: "todo", title: "call the client", status: "active" });
  await handleChatMessage(CHAT_ID, "what are my to-dos?", new Date());
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "You have 1 to-do: call the client.");
});

test("a write tool call sends its own immediate confirmation before the loop's final reply", async () => {
  const [task] = await db.insert(tasks).values({ type: "todo", title: "call the client", status: "active" }).returning();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "mark_todo_done", arguments: JSON.stringify({ id: task.id }) } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Anything else?" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "mark call the client as done", new Date());
  expect(mockSendMessage).toHaveBeenNthCalledWith(1, CHAT_ID, expect.stringContaining("Done"));
  expect(mockSendMessage).toHaveBeenNthCalledWith(2, CHAT_ID, "Anything else?");
  const [updated] = await db.select().from(tasks).where(eq(tasks.id, task.id));
  expect(updated.status).toBe("completed");
});

test("a write tool call for an id that no longer exists sends no false confirmation, and the loop's own reply still goes out", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "mark_todo_done", arguments: JSON.stringify({ id: randomUUID() }) } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I couldn't find that one — can you check the title?" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "mark that as done", new Date());
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "I couldn't find that one — can you check the title?");
});

test("conversation history is passed to Groq as prior context", async () => {
  await appendMessage(CHAT_ID, "user", "add buy milk to todo", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(CHAT_ID, "assistant", "✅ To-do added: buy milk", new Date("2026-01-01T00:00:01Z"));
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I can't change a due date — resend it as a new to-do if you want a different one." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "actually make that due Friday", new Date("2026-01-01T00:01:00Z"));
  const firstRequestBody = JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body));
  expect(firstRequestBody).toContain("buy milk");
});

test("never throws — an unexpected Groq failure still sends a safe reply", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  await expect(handleChatMessage(CHAT_ID, "hello", new Date())).resolves.toBeUndefined();
  expect(mockSendMessage).toHaveBeenCalled();
});

test("the system prompt forbids claiming an action succeeded without a successful tool call, states what it cannot do, and discourages sign-off questions", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "hello", new Date());
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  const systemMessage = (body.messages[0].content as string).toLowerCase();
  expect(systemMessage).toContain("cannot create a new to-do");
  expect(systemMessage).toContain("never say something was done");
  expect(systemMessage).toContain("sign-off");
});

test("a mark_posting_schedule_entry_done call for a key matching no real sheet entry sends no false confirmation", async () => {
  mockFetchPostingScheduleCsv.mockResolvedValue("Client,Video,Edit By,Post Date,Notes,Posted\n");
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "mark_posting_schedule_entry_done", arguments: JSON.stringify({ entryKey: "Nonexistent|Video|2026-01-01" }) } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "I couldn't find that entry." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await handleChatMessage(CHAT_ID, "mark that posting as done", new Date());
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  expect(mockSendMessage).toHaveBeenCalledWith(CHAT_ID, "I couldn't find that entry.");
});
