import { timingSafeEqual } from "@/lib/auth/timing-safe-equal";

/**
 * Secret-header auth for `/api/telegram/webhook`. Telegram can't do the
 * app's passcode-session handshake, so the webhook is allowlisted past
 * `middleware.ts`'s cookie check and instead verifies the per-webhook
 * secret Telegram echoes back on every call (set once via `setWebhook`'s
 * `secret_token`), same fail-closed shape as `checkCronSecret`.
 */
export function checkTelegramWebhookSecret(req: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return false;
  }

  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (!header) {
    return false;
  }

  return timingSafeEqual(header, secret);
}

/**
 * Whether `chatId` is one of the Telegram chats the capture bot acts on —
 * a comma-separated allowlist (Callum's own chat, plus anyone else he's
 * added), fails closed just like `checkTelegramWebhookSecret` if unset.
 */
export function isAllowedChatId(chatId: number): boolean {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS;
  if (!raw) {
    return false;
  }

  const allowed = raw.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  return allowed.includes(String(chatId));
}
