import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, contentIdeas, telegramUpdates } from "@/lib/db/schema";
import { createTodo } from "@/lib/tasks/create-todo";
import { handleChatMessage } from "@/lib/telegram/chat-handler";
import { handleCallbackQuery } from "@/lib/telegram/callback-handler";
import { appendMessage, shouldSkipClassifier } from "@/lib/telegram/conversation-memory";
import { checkTelegramWebhookSecret, isAllowedChatId } from "@/lib/telegram/webhook-auth";
import { downloadFile, getFilePath, sendMessage } from "@/lib/telegram/client";
import { formatLocalDateTime, parseCaptureMessage, transcribeVoice } from "@/lib/groq/client";

// Chains up to four external calls (Telegram file lookup + download, then
// OpenAI transcription + parsing) — matches the cron routes' own
// maxDuration, so a slow run ends in a reply (the try/catch below) rather
// than being killed mid-flight by the platform's default timeout, which
// would otherwise leave the message claimed (via the de-dup insert) but
// never actually saved or replied to.
export const maxDuration = 60;

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    voice?: { file_id: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

/** A failed reply must never crash the webhook — logged and swallowed. */
async function replySafely(chatId: number, text: string): Promise<void> {
  try {
    await sendMessage(chatId, text);
  } catch (error) {
    console.error("telegram webhook: failed to send reply", error);
  }
}

/**
 * Conversation-memory logging is purely additive (Task 2) — it must never
 * be able to turn an already-successful capture into a false "couldn't
 * save, please resend" (final-review Important 1), so a failure here is
 * logged and swallowed exactly like `replySafely`, not allowed to
 * propagate into the capture flow's own try/catch.
 */
async function logToMemorySafely(chatId: number, role: "user" | "assistant", content: string): Promise<void> {
  try {
    await appendMessage(chatId, role, content, new Date());
  } catch (error) {
    console.error("telegram webhook: failed to log to conversation memory", error);
  }
}

/**
 * The clarifying-question routing check is a convenience, not a hard
 * dependency — if conversation memory is unreachable, the safe default is
 * to fall through to the normal classifier rather than letting an
 * unhandled throw here crash the request (final-review Important 2): the
 * `telegramUpdates` de-dup row is already committed by this point, so an
 * uncaught error would silently lose the message on Telegram's retry.
 */
async function shouldSkipClassifierSafely(chatId: number): Promise<boolean> {
  try {
    return await shouldSkipClassifier(chatId, new Date());
  } catch (error) {
    console.error("telegram webhook: failed to check conversation memory for routing", error);
    return false;
  }
}

/**
 * Receives every Telegram update for the capture bot. Always responds 200
 * once past the secret check (Telegram retries on a non-200 response),
 * covering: de-dup of a retried `update_id`, the allowed-chats list,
 * voice transcription, structured parsing, and writing the result as a
 * to-do or a content idea with a one-line reply either way.
 */
export async function POST(request: Request) {
  if (!checkTelegramWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update: unknown = await request.json().catch(() => null);
  const message = (update as TelegramUpdate | null)?.message;
  const callbackQuery = (update as TelegramUpdate | null)?.callback_query;
  if ((!message && !callbackQuery) || typeof (update as TelegramUpdate).update_id !== "number") {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }
  const updateId = (update as TelegramUpdate).update_id;

  // De-dup: a retried delivery of the same update_id is a no-op insert.
  // Applies to both update kinds below, since it only reads update_id.
  const [inserted] = await db
    .insert(telegramUpdates)
    .values({ updateId })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    return NextResponse.json({ status: "duplicate" }, { status: 200 });
  }

  if (callbackQuery) {
    const callbackChatId = callbackQuery.message?.chat.id;
    if (!callbackQuery.data || !callbackQuery.message || callbackChatId === undefined || !isAllowedChatId(callbackChatId)) {
      return NextResponse.json({ status: "ignored" }, { status: 200 });
    }
    try {
      await handleCallbackQuery(callbackChatId, callbackQuery.message.message_id, callbackQuery.id, callbackQuery.data, new Date());
    } catch (error) {
      console.error("telegram webhook: failed to handle callback query", error);
    }
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }

  if (!message) {
    // Unreachable given the checks above (one of message/callbackQuery is
    // always present, and the callback_query branch above always returns),
    // but narrows the type for the message-handling code below.
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const chatId = message.chat.id;
  if (!isAllowedChatId(chatId)) {
    // Fully ignored — no DB write already happened beyond the de-dup row,
    // and no reply, so an unauthorized sender learns nothing.
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  let text: string;
  try {
    if (message.voice) {
      const filePath = await getFilePath(message.voice.file_id);
      const audio = await downloadFile(filePath);
      text = await transcribeVoice(audio, filePath);
    } else if (message.text) {
      text = message.text;
    } else {
      await replySafely(chatId, "I can only handle text or voice messages right now.");
      return NextResponse.json({ status: "ok" }, { status: 200 });
    }
  } catch (error) {
    console.error("telegram webhook: failed to resolve message text", error);
    await replySafely(chatId, "Something went wrong reading that — try again.");
    return NextResponse.json({ status: "error" }, { status: 200 });
  }

  if (await shouldSkipClassifierSafely(chatId)) {
    // The bot's own last message was a clarifying question within the
    // last ~10 minutes — a short reply like "the dentist one" answering
    // it would otherwise risk being misclassified by parseCaptureMessage
    // as a fresh to-do. Skip the classifier and recognized-clients lookup
    // entirely, straight to the chat handler that's already mid-exchange.
    await handleChatMessage(chatId, text, new Date());
    return NextResponse.json({ status: "ok" }, { status: 200 });
  }

  const recognizedClients = await db.select().from(clients).where(eq(clients.recognized, true));

  // Everything from here on (parsing, the todo/content-idea write, the
  // confirmation reply) is wrapped in one try/catch: the telegramUpdates
  // row above is already committed, so an unhandled throw here — a bad
  // dueAt string from the model, a transient DB error — would otherwise
  // lose the message silently (the retry is a no-op duplicate) with no
  // reply at all, exactly the anti-goal the spec calls out.
  try {
    const parsed = await parseCaptureMessage(text, new Date(), recognizedClients.map((c) => c.displayName));

    if (parsed.type === "todo") {
      let dueAt: Date | null = null;
      if (parsed.dueAt) {
        const candidate = new Date(parsed.dueAt);
        if (Number.isNaN(candidate.getTime())) {
          console.error(`telegram webhook: model returned an unparseable dueAt "${parsed.dueAt}", saving with no due date`);
        } else {
          dueAt = candidate;
        }
      }
      await createTodo({ title: parsed.text, dueAt });
      const dueSuffix = dueAt ? ` (due ${formatLocalDateTime(dueAt)})` : "";
      const confirmation = `✅ To-do added: ${parsed.text}${dueSuffix}`;
      await replySafely(chatId, confirmation);
      await logToMemorySafely(chatId, "user", text);
      await logToMemorySafely(chatId, "assistant", confirmation);
    } else if (parsed.type === "content_idea") {
      const matchedClient = parsed.client
        ? recognizedClients.find((c) => c.displayName.toLowerCase() === parsed.client!.toLowerCase())
        : undefined;
      if (!matchedClient) {
        await replySafely(
          chatId,
          `I couldn't match "${parsed.client ?? "that client"}" to a client — try resending with the exact client name.`,
        );
      } else {
        await db.insert(contentIdeas).values({ clientId: matchedClient.id, text: parsed.text });
        const confirmation = `✅ Content idea added for ${matchedClient.displayName}: ${parsed.text}`;
        await replySafely(chatId, confirmation);
        await logToMemorySafely(chatId, "user", text);
        await logToMemorySafely(chatId, "assistant", confirmation);
      }
    } else {
      await handleChatMessage(chatId, text, new Date());
    }
  } catch (error) {
    console.error("telegram webhook: failed to save the parsed message", error);
    await replySafely(chatId, "Couldn't save that — please resend.");
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
