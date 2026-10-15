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

export async function sendMessage(chatId: number, text: string): Promise<void> {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed: ${response.status} ${body}`);
  }
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
