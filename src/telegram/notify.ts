import { Telegraf } from "telegraf";
import { config } from "../config.js";
import type { StrategyResult } from "../types.js";

let bot: Telegraf | null = null;

function getBot(): Telegraf {
  if (!bot) bot = new Telegraf(config.telegramBotToken);
  return bot;
}

export async function sendTelegramText(
  text: string,
  options?: { parseMode?: "HTML" | "MarkdownV2" },
): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.warn("[telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return;
  }
  if (config.dryRun) {
    console.log("[dry-run] telegram:", text);
    return;
  }
  await getBot().telegram.sendMessage(config.telegramChatId, text, {
    parse_mode: options?.parseMode,
  });
}

export async function sendTelegramAlert(
  pair: string,
  result: StrategyResult,
  price: number,
): Promise<void> {
  const text = [
    `Pair: ${pair}`,
    `Signal: ${result.signal}`,
    `Setup: ${result.setup}`,
    `Price: ${price}`,
    `Reason: ${result.reason}`,
  ].join("\n");

  await sendTelegramText(text);
}
