import { beforeEach, expect, test } from "vitest";
import { checkTelegramWebhookSecret, isAllowedChatId } from "@/lib/telegram/webhook-auth";

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret";
});

function requestWith(headerValue?: string): Request {
  const headers: HeadersInit = {};
  if (headerValue !== undefined) headers["x-telegram-bot-api-secret-token"] = headerValue;
  return new Request("http://localhost/api/telegram/webhook", { headers });
}

test("accepts the correct secret header", () => {
  expect(checkTelegramWebhookSecret(requestWith("test-webhook-secret"))).toBe(true);
});

test("rejects a missing header", () => {
  expect(checkTelegramWebhookSecret(requestWith())).toBe(false);
});

test("rejects the wrong secret", () => {
  expect(checkTelegramWebhookSecret(requestWith("wrong"))).toBe(false);
});

test("fails closed when TELEGRAM_WEBHOOK_SECRET is not set", () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  expect(checkTelegramWebhookSecret(requestWith("test-webhook-secret"))).toBe(false);
});

beforeEach(() => {
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "999, 2025127249";
});

test("isAllowedChatId accepts the first id in the list", () => {
  expect(isAllowedChatId(999)).toBe(true);
});

test("isAllowedChatId accepts a later id in the list", () => {
  expect(isAllowedChatId(2025127249)).toBe(true);
});

test("isAllowedChatId rejects an id not in the list", () => {
  expect(isAllowedChatId(111)).toBe(false);
});

test("isAllowedChatId fails closed when TELEGRAM_ALLOWED_CHAT_IDS is not set", () => {
  delete process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  expect(isAllowedChatId(999)).toBe(false);
});

test("isAllowedChatId works with a single id and no commas", () => {
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "999";
  expect(isAllowedChatId(999)).toBe(true);
});
