import { Telegraf } from "telegraf";
import { config } from "../config.js";
import type { StrategyResult } from "../types.js";
import { buildDailyReportText } from "../report/daily.js";
import { buildWeeklyReportText } from "../report/weekly.js";

let bot: Telegraf | null = null;
let commandListenerStarted = false;

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

export async function startTelegramCommandListener(): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  if (config.dryRun) return;
  if (commandListenerStarted) return;
  const b = getBot();
  b.command("dailyreport", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const text = buildDailyReportText();
    await ctx.reply(text, { parse_mode: "HTML" });
  });
  b.command("weeklyreport", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const text = buildWeeklyReportText();
    await ctx.reply(text, { parse_mode: "HTML" });
  });
  await b.launch();
  commandListenerStarted = true;
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
