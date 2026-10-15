import { beforeEach, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { clients, contentIdeas, tasks, telegramUpdates } from "@/lib/db/schema";

vi.mock("@/lib/telegram/client", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getFilePath: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/lib/openai/client", () => ({
  transcribeVoice: vi.fn(),
  parseCaptureMessage: vi.fn(),
}));

// Wraps the real createTodo so every existing test still hits the real DB
// insert by default — only the two tests below override it to simulate a
// write failure.
vi.mock("@/lib/tasks/create-todo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tasks/create-todo")>("@/lib/tasks/create-todo");
  return { ...actual, createTodo: vi.fn(actual.createTodo) };
});

import { downloadFile, getFilePath, sendMessage } from "@/lib/telegram/client";
import { parseCaptureMessage, transcribeVoice } from "@/lib/openai/client";
import { createTodo } from "@/lib/tasks/create-todo";
import { POST } from "@/app/api/telegram/webhook/route";

const mockSendMessage = vi.mocked(sendMessage);
const mockGetFilePath = vi.mocked(getFilePath);
const mockDownloadFile = vi.mocked(downloadFile);
const mockTranscribeVoice = vi.mocked(transcribeVoice);
const mockParseCaptureMessage = vi.mocked(parseCaptureMessage);
const mockCreateTodo = vi.mocked(createTodo);

process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
process.env.TELEGRAM_ALLOWED_CHAT_ID = "999";
const ALLOWED_CHAT_ID = 999;

function updateRequest(body: unknown, secret = "test-webhook-secret"): Request {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(contentIdeas);
  await db.delete(telegramUpdates);
  await db.delete(clients);
  mockSendMessage.mockClear().mockResolvedValue(undefined);
  mockGetFilePath.mockClear();
  mockDownloadFile.mockClear();
  mockTranscribeVoice.mockClear();
  mockParseCaptureMessage.mockClear();
  mockCreateTodo.mockClear();
});

test("returns 401 when the secret header is wrong", async () => {
  const res = await POST(updateRequest({ update_id: 1 }, "wrong"));
  expect(res.status).toBe(401);
});

test("a text message classified as todo creates a task and replies with a confirmation", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "call the client", dueAt: null });
  const res = await POST(updateRequest({ update_id: 1, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, call the client" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("call the client");
  expect(mockSendMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, expect.stringContaining("call the client"));
});

test("a text message classified as content_idea with a matching client creates an idea and replies", async () => {
  const [client] = await db.insert(clients).values({ tag: "arc", displayName: "ARC", recognized: true, lastActivityAt: null }).returning();
  mockParseCaptureMessage.mockResolvedValue({ type: "content_idea", client: "ARC", text: "before and after reel", dueAt: null });
  const res = await POST(updateRequest({ update_id: 2, message: { chat: { id: ALLOWED_CHAT_ID }, text: "content idea for ARC, before and after reel" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(contentIdeas);
  expect(rows).toHaveLength(1);
  expect(rows[0].clientId).toBe(client.id);
  expect(mockSendMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, expect.stringContaining("ARC"));
});

test("a content_idea with a client name that matches nothing replies with a couldn't-match message and writes nothing", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "content_idea", client: "Nonexistent Co", text: "idea", dueAt: null });
  const res = await POST(updateRequest({ update_id: 3, message: { chat: { id: ALLOWED_CHAT_ID }, text: "content idea for Nonexistent Co, idea" } }));
  expect(res.status).toBe(200);
  expect(await db.select().from(contentIdeas)).toHaveLength(0);
  expect(mockSendMessage).toHaveBeenCalled();
});

test("an unclear message writes nothing and asks Callum to resend", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "unclear", client: null, text: "hmm", dueAt: null });
  const res = await POST(updateRequest({ update_id: 4, message: { chat: { id: ALLOWED_CHAT_ID }, text: "hmm" } }));
  expect(res.status).toBe(200);
  expect(await db.select().from(tasks)).toHaveLength(0);
  expect(await db.select().from(contentIdeas)).toHaveLength(0);
  expect(mockSendMessage).toHaveBeenCalled();
});

test("a message from a chat other than the allowed one is fully ignored — no DB write, no reply", async () => {
  const res = await POST(updateRequest({ update_id: 5, message: { chat: { id: 111 }, text: "to do, anything" } }));
  expect(res.status).toBe(200);
  expect(await db.select().from(tasks)).toHaveLength(0);
  expect(mockSendMessage).not.toHaveBeenCalled();
});

test("the same update_id delivered twice is only processed once", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "once only", dueAt: null });
  const update = { update_id: 6, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, once only" } };
  await POST(updateRequest(update));
  await POST(updateRequest(update));
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
});

test("a voice message is transcribed before being parsed", async () => {
  mockGetFilePath.mockResolvedValue("voice/f1.oga");
  mockDownloadFile.mockResolvedValue(new ArrayBuffer(8));
  mockTranscribeVoice.mockResolvedValue("to do, pick up the drive");
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "pick up the drive", dueAt: null });
  const res = await POST(updateRequest({ update_id: 7, message: { chat: { id: ALLOWED_CHAT_ID }, voice: { file_id: "file-1" } } }));
  expect(res.status).toBe(200);
  expect(mockTranscribeVoice).toHaveBeenCalled();
  expect(mockParseCaptureMessage).toHaveBeenCalledWith("to do, pick up the drive", expect.any(Date), expect.any(Array));
});

test("a reply-send failure doesn't prevent the underlying write or crash the request", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "still saved", dueAt: null });
  mockSendMessage.mockRejectedValueOnce(new Error("Telegram is down"));
  const res = await POST(updateRequest({ update_id: 8, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, still saved" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
});

test("an unparseable dueAt from the model doesn't crash the request — the todo is saved with no due date", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "bad date todo", dueAt: "not-a-real-date" });
  const res = await POST(updateRequest({ update_id: 9, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, bad date todo" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("bad date todo");
  expect(rows[0].dueAt).toBeNull();
  expect(mockSendMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, expect.stringContaining("bad date todo"));
});

test("a failure saving the parsed message replies with an error instead of crashing", async () => {
  mockParseCaptureMessage.mockResolvedValue({ type: "todo", client: null, text: "will fail to save", dueAt: null });
  mockCreateTodo.mockRejectedValueOnce(new Error("database is down"));
  const res = await POST(updateRequest({ update_id: 10, message: { chat: { id: ALLOWED_CHAT_ID }, text: "to do, will fail to save" } }));
  expect(res.status).toBe(200);
  const rows = await db.select().from(tasks).where(eq(tasks.type, "todo"));
  expect(rows).toHaveLength(0);
  expect(mockSendMessage).toHaveBeenCalledWith(ALLOWED_CHAT_ID, expect.stringContaining("resend"));
});
