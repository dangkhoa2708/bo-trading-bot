import { sendTelegramText } from "../telegram/notify.js";

const ANSI_REGEX = /\x1B\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, "");
}

export async function logRuntime(
  message: string,
  level: "log" | "warn" | "error" = "log",
  telegram?: { text: string; parseMode?: "HTML" | "MarkdownV2" },
): Promise<void> {
  if (level === "warn") console.warn(message);
  else if (level === "error") console.error(message);
  else console.log(message);

  const plain = stripAnsi(message);
  try {
    await sendTelegramText(telegram?.text ?? plain, {
      parseMode: telegram?.parseMode,
    });
  } catch (e) {
    console.error("[runtime-log] telegram send failed", e);
  }
}
