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
