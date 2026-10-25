import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { conversationMessages } from "@/lib/db/schema";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  role: ConversationRole;
  content: string;
  createdAt: Date;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/** Logs one turn of a chat — written by both the chat handler and the existing capture flow. */
export async function appendMessage(
  chatId: number,
  role: ConversationRole,
  content: string,
  at: Date,
): Promise<void> {
  await db.insert(conversationMessages).values({
    chatId: String(chatId),
    role,
    content,
    createdAt: at,
  });
}

/** The last `limit` messages for `chatId`, oldest first. */
export async function getRecentMessages(chatId: number, limit: number): Promise<ConversationMessage[]> {
  const rows = await db
    .select({
      role: conversationMessages.role,
      content: conversationMessages.content,
      createdAt: conversationMessages.createdAt,
    })
    .from(conversationMessages)
    .where(eq(conversationMessages.chatId, String(chatId)))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(limit);

  return rows.reverse();
}

/**
 * Whether the next incoming message should skip the to-do/content-idea
 * classifier entirely and go straight to the chat handler — true only
 * when the bot's own last message in this chat was a clarifying question
 * (heuristically: ends with "?") asked within the last ~10 minutes.
 * Without this, a short reply like "the dentist one" answering the bot's
 * own disambiguation question risks being misclassified as a fresh to-do.
 */
export async function shouldSkipClassifier(chatId: number, now: Date): Promise<boolean> {
  const [last] = await getRecentMessages(chatId, 1);
  if (!last || last.role !== "assistant") {
    return false;
  }
  if (!last.content.trim().endsWith("?")) {
    return false;
  }
  return now.getTime() - last.createdAt.getTime() <= TEN_MINUTES_MS;
}
