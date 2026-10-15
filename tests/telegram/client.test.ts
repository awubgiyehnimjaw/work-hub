import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { downloadFile, getFilePath, sendMessage } from "@/lib/telegram/client";

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
