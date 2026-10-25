// Groq's API is OpenAI-compatible (same request/response shapes at
// /openai/v1/...), so this client is a near-drop-in replacement for the
// equivalent OpenAI calls, just pointed at open-weight models instead —
// switched to from OpenAI after the Telegram bot's first live run hit
// "insufficient_quota" with no billing set up; Groq's free tier needs no
// card and is far more than this single-user bot's volume will ever use.
const GROQ_API_BASE = "https://api.groq.com/openai";

const TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
// Confirmed live against this account's actual GET /v1/models response
// (not just a provider's own docs/changelog) — Groq's hosted lineup
// shifts over time (llama-3.3-70b-versatile, used originally, had
// already been delisted by the time this was first tried live), so the
// model list is the source of truth, not any cached assumption about it.
// On zero marginal cost (free tier either way), this picks the largest
// available general chat model for the most reliable classification,
// rather than the smallest/cheapest — unlike the original OpenAI choice,
// price is no longer a differentiator here.
const PARSE_MODEL = "openai/gpt-oss-120b";

// ARC Hub is a single-user app for Callum, who operates on Singapore
// time — hardcoded the same way lib/reminders/check.ts already assumes
// SGT for the weekly digest, rather than adding a new env var for a
// single-user constant. Used both to give the model a correct local-time
// reference for resolving "tomorrow"/"Friday" (the API itself only ever
// sees UTC `now`, so without this a relative date resolves against the
// wrong calendar day near midnight UTC) and to format a due-date back
// into the confirmation reply the same way the browser (also in SGT)
// would show it.
const TIMEZONE = "Asia/Singapore";

const localDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  dateStyle: "full",
  timeStyle: "short",
});

/** Formats a date in Callum's own timezone — used for the Telegram confirmation reply. */
export function formatLocalDateTime(date: Date): string {
  return localDateTimeFormatter.format(date);
}

export interface ParsedCapture {
  type: "todo" | "content_idea" | "unclear";
  client: string | null;
  text: string;
  dueAt: string | null;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export type ToolDispatcher = (call: ToolCallRequest) => Promise<string>;

const AGENT_MODEL = PARSE_MODEL;
const MAX_AGENT_ROUNDS = 5;
const AGENT_FALLBACK_REPLY = "Sorry, I couldn't come up with a reply to that.";

interface GroqChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function requireEnv(name: "GROQ_API_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

export async function transcribeVoice(audio: ArrayBuffer, filename: string): Promise<string> {
  const apiKey = requireEnv("GROQ_API_KEY");

  // Telegram voice notes are Opus-in-OGG, delivered with a ".oga" path
  // (e.g. "voice/file_1.oga") and no MIME type of their own. Normalized
  // to an explicit ".ogg" filename and audio/ogg type rather than relying
  // on the runtime to infer one from a blank Blob — the caller's
  // `filename` (Telegram's own file path) isn't used here.
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", TRANSCRIPTION_MODEL);

  const response = await fetch(`${GROQ_API_BASE}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Groq transcription failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
}

function buildParseSystemPrompt(now: Date, clientNames: string[]): string {
  return [
    "You turn one message from Callum into a single JSON object with exactly these fields:",
    '{ "type": "todo" | "content_idea" | "unclear", "client": string | null, "text": string, "dueAt": string | null }',
    "",
    `Callum's local time right now is ${localDateTimeFormatter.format(now)} (${TIMEZONE}) — resolve any relative date mentioned ("tomorrow", "Friday", "in two hours") against THIS local time and calendar day, not UTC. Return the resolved moment as a precise ISO 8601 UTC timestamp (with a "Z" suffix or explicit offset) in "dueAt" — i.e. convert the local moment you resolved to its equivalent UTC instant. If no date is mentioned, or the message is a content idea, "dueAt" must be null.`,
    "",
    `\"type\" is \"todo\" when Callum is asking for something to be added to his to-do list, \"content_idea\" when he's dropping a content idea for a client, and \"unclear\" when you genuinely cannot tell which.`,
    "",
    `\"client\" is only used for a content idea, and must be exactly one of this list (case-insensitive match is fine, but return the value exactly as written here): ${clientNames.join(", ")}. If the message names a client not on this list, or no client at all for a content idea, set \"client\" to null — do not invent one.`,
    "",
    '"text" is the actual to-do or idea content, with the type/client framing stripped out.',
    "",
    "Return only the JSON object, nothing else.",
  ].join("\n");
}

function parseFallback(text: string): ParsedCapture {
  return { type: "unclear", client: null, text, dueAt: null };
}

function isParsedCapture(value: unknown): value is ParsedCapture {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const validType = record.type === "todo" || record.type === "content_idea" || record.type === "unclear";
  const validClient = record.client === null || typeof record.client === "string";
  const validText = typeof record.text === "string";
  const validDueAt = record.dueAt === null || typeof record.dueAt === "string";
  return validType && validClient && validText && validDueAt;
}

/**
 * Never throws — any failure (network, non-2xx, malformed model output)
 * falls back to `{ type: "unclear", client: null, text, dueAt: null }` so
 * the webhook caller can always trust the result is usable.
 */
export async function parseCaptureMessage(
  text: string,
  now: Date,
  clientNames: string[],
): Promise<ParsedCapture> {
  try {
    const apiKey = requireEnv("GROQ_API_KEY");

    const response = await fetch(`${GROQ_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PARSE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildParseSystemPrompt(now, clientNames) },
          { role: "user", content: text },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`parseCaptureMessage: Groq request failed: ${response.status} ${body}`);
      return parseFallback(text);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("parseCaptureMessage: Groq response had no message content");
      return parseFallback(text);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      console.error("parseCaptureMessage: model content was not valid JSON", error);
      return parseFallback(text);
    }

    if (!isParsedCapture(parsed)) {
      console.error("parseCaptureMessage: model content did not match the expected shape");
      return parseFallback(text);
    }

    return parsed;
  } catch (error) {
    console.error("parseCaptureMessage: unexpected failure", error);
    return parseFallback(text);
  }
}

/**
 * Confirmed live against the real Groq API (`openai/gpt-oss-120b`,
 * 2026-10-25): `choices[0].message.tool_calls` is an array of
 * `{ id, type: "function", function: { name, arguments } }`, with
 * `arguments` as a JSON-encoded string — the standard OpenAI-compatible
 * shape assumed below. A plain-text reply omits `tool_calls` entirely and
 * sets `content` to the reply string. The model also returns its own
 * `reasoning` field alongside either shape — not resent on the next
 * round; only `role`/`content`/`tool_calls` are preserved in history.
 */
export async function runToolCallingAgent(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  userText: string,
  tools: ToolDefinition[],
  dispatch: ToolDispatcher,
): Promise<string> {
  const apiKey = requireEnv("GROQ_API_KEY");

  const messages: GroqChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content }) as GroqChatMessage),
    { role: "user", content: userText },
  ];

  const wireTools = tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

  for (let round = 0; round < MAX_AGENT_ROUNDS; round++) {
    const response = await fetch(`${GROQ_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AGENT_MODEL,
        messages,
        ...(wireTools.length > 0 ? { tools: wireTools } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`runToolCallingAgent: Groq request failed: ${response.status} ${body}`);
      return AGENT_FALLBACK_REPLY;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: GroqChatMessage["tool_calls"] } }>;
    };
    const message = data.choices?.[0]?.message;

    if (!message) {
      console.error("runToolCallingAgent: Groq response had no message");
      return AGENT_FALLBACK_REPLY;
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

      for (const call of message.tool_calls) {
        let resultContent: string;
        try {
          resultContent = await dispatch({ id: call.id, name: call.function.name, arguments: call.function.arguments });
        } catch (error) {
          resultContent = `Error executing tool "${call.function.name}": ${error instanceof Error ? error.message : String(error)}`;
        }
        messages.push({ role: "tool", content: resultContent, tool_call_id: call.id });
      }

      continue;
    }

    if (message.content) {
      return message.content;
    }

    return AGENT_FALLBACK_REPLY;
  }

  return AGENT_FALLBACK_REPLY;
}
