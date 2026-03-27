import { Telegraf } from "telegraf";
import { config } from "../config.js";
import type { StrategyResult } from "../types.js";
import {
  buildDailyReportDetailsHtml,
  buildDailyReportSummaryHtml,
  buildDailyReportText,
} from "../report/daily.js";
import {
  buildWeeklyReportDetailsHtml,
  buildWeeklyReportSummaryHtml,
  buildWeeklyReportText,
} from "../report/weekly.js";
import { getStatusSnapshot } from "../runtime/status.js";
import { buildChartTestTelegramPayload } from "../logging/verify.js";
import { tradingViewBinanceUrl } from "../chart/externalLinks.js";
import { BACKTEST_WINDOW_DAYS, runBacktest } from "../backtest/runner.js";
import { buildBacktestReportHtml } from "../report/backtest.js";
import { recordHumanPick } from "../prediction/humanPick.js";

type ReportInlineButton =
  | { text: string; url: string }
  | { text: string; callback_data: string };

/** Reports: TradingView 5m + optional Show/Hide details toggle. */
function reportReplyMarkup(
  kind: "d" | "w",
  expanded: boolean,
  hasDetails: boolean,
): { inline_keyboard: ReportInlineButton[][] } {
  const chartUrl = tradingViewBinanceUrl(config.symbol, "5m");
  const rows: ReportInlineButton[][] = [
    [{ text: "📊 Open chart (5m)", url: chartUrl }],
  ];
  if (hasDetails) {
    rows.push([
      {
        text: expanded ? "Hide details" : "Show details",
        callback_data: `rpt:${kind}:${expanded ? "0" : "1"}`,
      },
    ]);
  }
  return { inline_keyboard: rows };
}

async function fetchOk(url: string, timeoutMs = 4000): Promise<boolean> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

let bot: Telegraf | null = null;
let commandListenerStarted = false;

function getBot(): Telegraf {
  if (!bot) bot = new Telegraf(config.telegramBotToken);
  return bot;
}

export async function sendTelegramText(
  text: string,
  options?: {
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: {
      inline_keyboard: Array<
        Array<{ text: string; url: string } | { text: string; callback_data: string }>
      >;
    };
  },
): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.warn("[telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return;
  }
  if (config.dryRun) {
    console.log("[dry-run] telegram:", text);
    if (options?.replyMarkup) {
      console.log("[dry-run] telegram reply_markup:", JSON.stringify(options.replyMarkup));
    }
    return;
  }
  await getBot().telegram.sendMessage(config.telegramChatId, text, {
    parse_mode: options?.parseMode,
    reply_markup: options?.replyMarkup,
  });
}

export async function startTelegramCommandListener(): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  if (config.dryRun) return;
  if (commandListenerStarted) return;
  const b = getBot();
  b.command("status", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const s = getStatusSnapshot();
    const [telegramOk, binanceOk] = await Promise.all([
      fetchOk(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`),
      fetchOk("https://api.binance.com/api/v3/ping"),
    ]);
    const wsLine = `• WS: <b>${s.wsConnected ? "CONNECTED" : "DISCONNECTED"}</b>${
      s.wsLastEventAgeSec === null
        ? ""
        : ` (last event <code>${s.wsLastEventAgeSec}s</code> ago)`
    }`;
    const text = [
      "🩺 <b>Server health</b>",
      `• Uptime: <code>${s.uptimeSec}s</code>`,
      wsLine,
      `• Telegram API: <b>${telegramOk ? "OK" : "FAIL"}</b>`,
      `• Binance REST: <b>${binanceOk ? "OK" : "FAIL"}</b>`,
    ].join("\n");
    await ctx.reply(text, { parse_mode: "HTML" });
  });
  b.command("dailyreport", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const summary = buildDailyReportSummaryHtml();
    const hasDetails = buildDailyReportDetailsHtml().length > 0;
    await ctx.reply(summary, {
      parse_mode: "HTML",
      reply_markup: reportReplyMarkup("d", false, hasDetails),
    });
  });
  b.command("weeklyreport", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const summary = buildWeeklyReportSummaryHtml();
    const hasDetails = buildWeeklyReportDetailsHtml().length > 0;
    await ctx.reply(summary, {
      parse_mode: "HTML",
      reply_markup: reportReplyMarkup("w", false, hasDetails),
    });
  });
  b.command("chart", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const { text, replyMarkup } = buildChartTestTelegramPayload(
      config.symbol,
      config.interval,
    );
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: replyMarkup });
  });
  b.command("backtest", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const cid = ctx.chat?.id;
    if (cid !== undefined) {
      await ctx.telegram.sendChatAction(cid, "typing");
    }
    const text =
      ctx.message && "text" in ctx.message ? ctx.message.text.trim() : "";
    const tokens = text.split(/\s+/).filter(Boolean);
    let days = BACKTEST_WINDOW_DAYS;
    if (tokens.length >= 2 && /^\d+$/.test(tokens[1]!)) {
      days = Math.max(1, Math.min(90, parseInt(tokens[1]!, 10)));
    }
    const r = await runBacktest({ days });
    if (!r.ok) {
      await ctx.reply(`Backtest failed: ${r.message}`);
      return;
    }
    const chartUrl = tradingViewBinanceUrl(config.symbol, "5m");
    await ctx.reply(buildBacktestReportHtml(r), {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "📊 Open chart (5m)", url: chartUrl }]],
      },
    });
  });
  b.on("callback_query", async (ctx) => {
    const cq = ctx.callbackQuery;
    const data = "data" in cq ? cq.data : undefined;
    if (!data) return;

    const pickMatch = /^pick:(\d+):([UD])$/.exec(data);
    if (pickMatch) {
      const chatId = String(ctx.chat?.id ?? "");
      if (chatId !== config.telegramChatId) {
        await ctx.answerCbQuery("Unauthorized");
        return;
      }
      const fromOpenTime = Number(pickMatch[1]);
      const dir = pickMatch[2] === "U" ? "UP" : "DOWN";
      const ok = recordHumanPick(fromOpenTime, dir);
      if (!ok) {
        await ctx.answerCbQuery("Unknown or expired — next candle already closed?");
        return;
      }
      await ctx.answerCbQuery(`Recorded your pick: ${dir}`);
      return;
    }

    if (!data.startsWith("rpt:")) return;
    const parts = data.split(":");
    if (parts.length !== 3) return;
    const [, kind, flag] = parts;
    if (kind !== "d" && kind !== "w") return;
    if (flag !== "0" && flag !== "1") return;

    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.answerCbQuery("Unauthorized");
      return;
    }

    const msg = ctx.callbackQuery.message;
    if (!msg || !("message_id" in msg)) {
      await ctx.answerCbQuery("Message expired");
      return;
    }

    const expanded = flag === "1";
    const text =
      kind === "d"
        ? expanded
          ? buildDailyReportText()
          : buildDailyReportSummaryHtml()
        : expanded
          ? buildWeeklyReportText()
          : buildWeeklyReportSummaryHtml();

    const hasDetails =
      kind === "d"
        ? buildDailyReportDetailsHtml().length > 0
        : buildWeeklyReportDetailsHtml().length > 0;

    try {
      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: reportReplyMarkup(kind, expanded, hasDetails),
      });
      await ctx.answerCbQuery();
    } catch (err) {
      console.warn("[telegram] report toggle edit failed:", err);
      await ctx.answerCbQuery("Could not update message");
    }
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
