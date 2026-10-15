import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { clients, contentIdeas, telegramUpdates } from "@/lib/db/schema";
import { createTodo } from "@/lib/tasks/create-todo";
import { checkTelegramWebhookSecret } from "@/lib/telegram/webhook-auth";
import { downloadFile, getFilePath, sendMessage } from "@/lib/telegram/client";
import { parseCaptureMessage, transcribeVoice } from "@/lib/openai/client";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    voice?: { file_id: string };
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
 * Receives every Telegram update for the capture bot. Always responds 200
 * once past the secret check (Telegram retries on a non-200 response),
 * covering: de-dup of a retried `update_id`, the single allowed chat,
 * voice transcription, structured parsing, and writing the result as a
 * to-do or a content idea with a one-line reply either way.
 */
export async function POST(request: Request) {
  if (!checkTelegramWebhookSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update: unknown = await request.json().catch(() => null);
  const message = (update as TelegramUpdate | null)?.message;
  if (!message || typeof (update as TelegramUpdate).update_id !== "number") {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }
  const updateId = (update as TelegramUpdate).update_id;

  // De-dup: a retried delivery of the same update_id is a no-op insert.
  const [inserted] = await db
    .insert(telegramUpdates)
    .values({ updateId })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    return NextResponse.json({ status: "duplicate" }, { status: 200 });
  }

  const chatId = message.chat.id;
  if (String(chatId) !== process.env.TELEGRAM_ALLOWED_CHAT_ID) {
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

  const recognizedClients = await db.select().from(clients).where(eq(clients.recognized, true));
  const parsed = await parseCaptureMessage(text, new Date(), recognizedClients.map((c) => c.displayName));

  if (parsed.type === "todo") {
    const dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;
    await createTodo({ title: parsed.text, dueAt });
    const dueSuffix = dueAt ? ` (due ${dueAt.toLocaleString()})` : "";
    await replySafely(chatId, `✅ To-do added: ${parsed.text}${dueSuffix}`);
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
      await replySafely(chatId, `✅ Content idea added for ${matchedClient.displayName}: ${parsed.text}`);
    }
  } else {
    await replySafely(
      chatId,
      'I couldn\'t tell if that\'s a to-do or a content idea — try again starting with "to do" or "content idea for <client>".',
    );
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
