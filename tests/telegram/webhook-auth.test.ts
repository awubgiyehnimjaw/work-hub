import { beforeEach, expect, test } from "vitest";
import { checkTelegramWebhookSecret } from "@/lib/telegram/webhook-auth";

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
