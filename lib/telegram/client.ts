const TELEGRAM_API_BASE = "https://api.telegram.org";

function requireEnv(name: "TELEGRAM_BOT_TOKEN"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set`);
  }
  return value;
}

interface TelegramGetFileResponse {
  result?: { file_path?: string };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

async function postToTelegram(method: string, body: Record<string, unknown>): Promise<void> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`Telegram ${method} failed: ${response.status} ${responseBody}`);
  }
}

export async function sendMessage(chatId: number, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
  await postToTelegram("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup !== undefined ? { reply_markup: { inline_keyboard: replyMarkup } } : {}),
  });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  await postToTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(replyMarkup !== undefined ? { reply_markup: { inline_keyboard: replyMarkup } } : {}),
  });
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await postToTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text !== undefined ? { text } : {}),
  });
}

/** The only chat proactive nags/digests/sweeps ever target — distinct from the plural `TELEGRAM_ALLOWED_CHAT_IDS`, which also includes others. */
export function getOwnerChatId(): number {
  const value = process.env.TELEGRAM_OWNER_CHAT_ID;
  const chatId = Number(value);
  if (!value || Number.isNaN(chatId)) {
    throw new Error("TELEGRAM_OWNER_CHAT_ID environment variable is not set");
  }
  return chatId;
}

export async function getFilePath(fileId: string): Promise<string> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram getFile failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as TelegramGetFileResponse;
  if (!data.result?.file_path) {
    throw new Error("Telegram getFile response is missing result.file_path");
  }
  return data.result.file_path;
}

export async function downloadFile(filePath: string): Promise<ArrayBuffer> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram file download failed: ${response.status} ${body}`);
  }

  return response.arrayBuffer();
}
