import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { parseCaptureMessage, runToolCallingAgent, transcribeVoice } from "@/lib/groq/client";

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

test("runToolCallingAgent returns the plain-text reply when the model calls no tools", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "You have 3 to-dos." } }] }), { status: 200 }),
  ));
  const result = await runToolCallingAgent("system", [], "what are my to-dos", [], async () => "");
  expect(result).toBe("You have 3 to-dos.");
});

test("runToolCallingAgent executes a tool call, sends the result back, and returns the model's follow-up reply", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_todos", arguments: "{}" } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "You have 1 to-do: call the client." } }],
    }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const dispatch = vi.fn().mockResolvedValue(JSON.stringify([{ id: "1", title: "call the client" }]));
  const result = await runToolCallingAgent("system", [], "what are my to-dos", [{ name: "list_todos", description: "d", parameters: {} }], dispatch);
  expect(dispatch).toHaveBeenCalledWith({ id: "call_1", name: "list_todos", arguments: "{}" });
  expect(result).toBe("You have 1 to-do: call the client.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("runToolCallingAgent returns a safe fallback reply when the model's response has neither tool_calls nor content", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null } }], finish_reason: "length" }), { status: 200 }),
  ));
  const result = await runToolCallingAgent("system", [], "hello", [], async () => "");
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

test("runToolCallingAgent stops after a capped number of rounds and returns a safe fallback reply", async () => {
  const alwaysCallsToolBody = JSON.stringify({
    choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: "list_todos", arguments: "{}" } }] } }],
  });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(alwaysCallsToolBody, { status: 200 }))));
  const result = await runToolCallingAgent("system", [], "loop forever", [{ name: "list_todos", description: "d", parameters: {} }], async () => "[]");
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

test("runToolCallingAgent feeds back an error string when a tool call's arguments aren't valid JSON-parseable by the dispatcher, instead of throwing", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "mark_todo_done", arguments: "not json" } }] } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Sorry, something went wrong." } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const dispatch = vi.fn().mockRejectedValue(new SyntaxError("bad json"));
  const result = await runToolCallingAgent("system", [], "mark it done", [{ name: "mark_todo_done", description: "d", parameters: {} }], dispatch);
  expect(result).toBe("Sorry, something went wrong.");
  const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(JSON.stringify(secondBody)).toContain("call_1");
});
