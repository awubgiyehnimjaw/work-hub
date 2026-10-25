import { beforeEach, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { conversationMessages } from "@/lib/db/schema";
import { appendMessage, getRecentMessages, shouldSkipClassifier } from "@/lib/telegram/conversation-memory";

beforeEach(async () => {
  await db.delete(conversationMessages);
});

test("getRecentMessages returns rows for that chat in chronological order", async () => {
  await appendMessage(1, "user", "first", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(1, "assistant", "second", new Date("2026-01-01T00:00:01Z"));
  await appendMessage(2, "user", "other chat", new Date("2026-01-01T00:00:02Z"));
  const rows = await getRecentMessages(1, 10);
  expect(rows.map((r) => r.content)).toEqual(["first", "second"]);
});

test("getRecentMessages returns at most the last `limit` rows", async () => {
  for (let i = 0; i < 12; i++) {
    await appendMessage(1, "user", `msg ${i}`, new Date(2026, 0, 1, 0, 0, i));
  }
  const rows = await getRecentMessages(1, 10);
  expect(rows).toHaveLength(10);
  expect(rows[rows.length - 1].content).toBe("msg 11");
});

test("shouldSkipClassifier is true when the last message is the bot asking a question within 10 minutes", async () => {
  const now = new Date("2026-01-01T00:10:00Z");
  await appendMessage(1, "user", "the dentist thing", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(1, "assistant", "Did you mean the dentist to-do or the vet one?", new Date("2026-01-01T00:05:00Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(true);
});

test("shouldSkipClassifier is false once more than 10 minutes have passed", async () => {
  const now = new Date("2026-01-01T00:20:00Z");
  await appendMessage(1, "assistant", "Which one did you mean?", new Date("2026-01-01T00:05:00Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(false);
});

test("shouldSkipClassifier is false when the last message is the bot's plain answer, not a question", async () => {
  const now = new Date("2026-01-01T00:01:00Z");
  await appendMessage(1, "assistant", "You have 3 to-dos due this week.", new Date("2026-01-01T00:00:00Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(false);
});

test("shouldSkipClassifier is false when the last message in that chat is from the user", async () => {
  const now = new Date("2026-01-01T00:01:00Z");
  await appendMessage(1, "assistant", "Which one?", new Date("2026-01-01T00:00:00Z"));
  await appendMessage(1, "user", "the dentist one", new Date("2026-01-01T00:00:30Z"));
  expect(await shouldSkipClassifier(1, now)).toBe(false);
});
