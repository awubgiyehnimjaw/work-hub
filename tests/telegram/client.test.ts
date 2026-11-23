import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { answerCallbackQuery, downloadFile, editMessageText, getFilePath, getOwnerChatId, sendMessage } from "@/lib/telegram/client";

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("sendMessage posts chat_id and text to the sendMessage endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await sendMessage(123, "hello");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/bottest-bot-token/sendMessage");
  expect(JSON.parse(init.body)).toEqual({ chat_id: 123, text: "hello" });
});

test("sendMessage throws on a non-2xx response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })));
  await expect(sendMessage(123, "hello")).rejects.toThrow();
});

test("getFilePath returns result.file_path from a successful response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { file_path: "voice/file_1.oga" } }), { status: 200 }),
    ),
  );
  expect(await getFilePath("file-id-1")).toBe("voice/file_1.oga");
});

test("downloadFile returns the response body as an ArrayBuffer", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { status: 200 })));
  const buffer = await downloadFile("voice/file_1.oga");
  expect(new Uint8Array(buffer)).toEqual(bytes);
});

test("throws when TELEGRAM_BOT_TOKEN is not set", async () => {
  const original = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  await expect(sendMessage(123, "hi")).rejects.toThrow("TELEGRAM_BOT_TOKEN");
  process.env.TELEGRAM_BOT_TOKEN = original;
});

test("sendMessage includes reply_markup when buttons are passed", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await sendMessage(123, "hello", [[{ text: "✅ Done", callback_data: "td|done|abc" }]]);
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({
    chat_id: 123,
    text: "hello",
    reply_markup: { inline_keyboard: [[{ text: "✅ Done", callback_data: "td|done|abc" }]] },
  });
});

test("editMessageText with an empty keyboard clears existing buttons", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await editMessageText(123, 456, "done", []);
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/editMessageText");
  expect(JSON.parse(init.body)).toEqual({
    chat_id: 123,
    message_id: 456,
    text: "done",
    reply_markup: { inline_keyboard: [] },
  });
});

test("editMessageText without replyMarkup omits reply_markup entirely", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  await editMessageText(123, 456, "hello");
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1].body)).toEqual({ chat_id: 123, message_id: 456, text: "hello" });
});

test("answerCallbackQuery posts the callback query id", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await answerCallbackQuery("cb-1", "Done");
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/answerCallbackQuery");
  expect(JSON.parse(init.body)).toEqual({ callback_query_id: "cb-1", text: "Done" });
});

test("getOwnerChatId returns the numeric chat id", () => {
  process.env.TELEGRAM_OWNER_CHAT_ID = "5835594329";
  expect(getOwnerChatId()).toBe(5835594329);
});

test("getOwnerChatId throws when unset", () => {
  delete process.env.TELEGRAM_OWNER_CHAT_ID;
  expect(() => getOwnerChatId()).toThrow("TELEGRAM_OWNER_CHAT_ID");
});
