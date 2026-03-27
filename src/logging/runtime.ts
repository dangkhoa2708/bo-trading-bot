import { sendTelegramText } from "../telegram/notify.js";

const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

export async function logRuntime(
  message: string,
  level: "log" | "warn" | "error" = "log",
  telegram?: {
    text: string;
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
  },
): Promise<void> {
  if (level === "warn") console.warn(message);
  else if (level === "error") console.error(message);
  else console.log(message);

  // Only send to Telegram when explicitly requested.
  if (!telegram) return;
  try {
    await sendTelegramText(stripAnsi(telegram.text), {
      parseMode: telegram.parseMode,
      replyMarkup: telegram.replyMarkup,
    });
  } catch (e) {
    console.error("[runtime-log] telegram send failed", e);
  }
}
