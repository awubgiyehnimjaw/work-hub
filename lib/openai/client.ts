const OPENAI_API_BASE = "https://api.openai.com";

// Picked as current, cost-appropriate defaults at build time (Oct 2026) —
// verify both are still live on OpenAI's model list before connecting a
// real API key; a retired model name here would make every capture fail
// at the API call rather than at build time.
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
// "gpt-5.6" alone routes to the flagship "Sol" tier — "-luna" is the
// fast/cheap tier, the right fit for a small structured-extraction task
// like this one (matches the design's "a small/cheap chat model is
// plenty"). Paired with a low reasoning effort for latency.
const PARSE_MODEL = "gpt-5.6-luna";
const PARSE_REASONING_EFFORT = "low";

// Work Hub is a single-user app for Callum, who operates on Singapore
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

function requireEnv(name: "OPENAI_API_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

export async function transcribeVoice(audio: ArrayBuffer, filename: string): Promise<string> {
  const apiKey = requireEnv("OPENAI_API_KEY");

  // Telegram voice notes are Opus-in-OGG, delivered with a ".oga" path
  // (e.g. "voice/file_1.oga") and no MIME type of their own. OpenAI's
  // transcription endpoint documents ".ogg" (not ".oga") as a supported
  // extension, so the upload is normalized to that regardless of what
  // Telegram's own file path used, with an explicit audio/ogg type rather
  // than relying on the browser/runtime to infer one from a blank Blob —
  // the caller's `filename` (Telegram's own file path) isn't used here.
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", TRANSCRIPTION_MODEL);

  const response = await fetch(`${OPENAI_API_BASE}/v1/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI transcription failed: ${response.status} ${body}`);
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
    const apiKey = requireEnv("OPENAI_API_KEY");

    const response = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: PARSE_MODEL,
        reasoning_effort: PARSE_REASONING_EFFORT,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildParseSystemPrompt(now, clientNames) },
          { role: "user", content: text },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`parseCaptureMessage: OpenAI request failed: ${response.status} ${body}`);
      return parseFallback(text);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("parseCaptureMessage: OpenAI response had no message content");
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
