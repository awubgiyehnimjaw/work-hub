import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { parseCaptureMessage, transcribeVoice } from "@/lib/groq/client";

beforeAll(() => {
  process.env.GROQ_API_KEY = "test-groq-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("transcribeVoice posts the audio and returns the transcript text", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ text: "call the client tomorrow" }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await transcribeVoice(new ArrayBuffer(8), "voice.oga");
  expect(result).toBe("call the client tomorrow");
  expect(String(fetchMock.mock.calls[0][0])).toContain("/v1/audio/transcriptions");
});

test("transcribeVoice throws on a non-2xx response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 500 })));
  await expect(transcribeVoice(new ArrayBuffer(8), "voice.oga")).rejects.toThrow();
});

test("parseCaptureMessage returns the parsed structure for a well-formed model response", async () => {
  const modelOutput = { type: "content_idea", client: "ARC", text: "before and after reel", dueAt: null };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput) } }] }), { status: 200 }),
    ),
  );
  const result = await parseCaptureMessage("content idea for ARC, before and after reel", new Date(), ["ARC", "LoveLots"]);
  expect(result).toEqual(modelOutput);
});

test("parseCaptureMessage sends the given client names and current text in the request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ type: "unclear", client: null, text: "x", dueAt: null }) } }] }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await parseCaptureMessage("hello", new Date(), ["ARC", "LoveLots"]);
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(JSON.stringify(body)).toContain("ARC");
  expect(JSON.stringify(body)).toContain("LoveLots");
});

test("parseCaptureMessage falls back to unclear on a non-2xx response instead of throwing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 500 })));
  const result = await parseCaptureMessage("hello", new Date(), ["ARC"]);
  expect(result).toEqual({ type: "unclear", client: null, text: "hello", dueAt: null });
});

test("parseCaptureMessage falls back to unclear when the model's content isn't valid JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }),
    ),
  );
  const result = await parseCaptureMessage("hello", new Date(), ["ARC"]);
  expect(result.type).toBe("unclear");
});
