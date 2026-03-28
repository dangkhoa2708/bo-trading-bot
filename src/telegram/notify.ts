import { randomUUID } from "node:crypto";
import { Telegraf } from "telegraf";
import { formatEther, parseEther } from "viem";
import { fetchKlines } from "../binance/rest.js";
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
import {
  buildChartTestTelegramPayload,
  formatPrePredictionTelegramLog,
  prePredictionReplyMarkup,
} from "../logging/verify.js";
import { tradingViewBinanceUrl } from "../chart/externalLinks.js";
import { BACKTEST_WINDOW_DAYS, runBacktest } from "../backtest/runner.js";
import { buildBacktestReportHtml } from "../report/backtest.js";
import { appendSignalLog } from "../logger.js";
import {
  enqueueFakeSignalForNextTick,
  FAKE_SIGNAL_SETUP,
} from "../prediction/injectedFakeSignal.js";
import {
  getPlacementLinkForOpenTime,
  recordHumanPick,
  registerAwaitingHumanPick,
} from "../prediction/humanPick.js";
import {
  buildLiveCountdownTelegramHtml,
  fetchPancakePredictionBnbCountdown,
} from "../pancakeswap/predictionCountdown.js";
import {
  claimPancakePredictionEpochs,
  formatPancakeBetFollowUpHtml,
  formatPancakeClaimTelegramHtml,
  normalizeBscPrivateKey,
  placePancakeBnbPredictionBet,
} from "../pancakeswap/predictionBet.js";
import {
  getPancakeBet,
  registerPendingPancakeBet,
  removePancakeBet,
} from "../pancakeswap/betTracker.js";
import { startPancakeOutcomePoller } from "../pancakeswap/outcomePoller.js";
import { appendPancakePlacementSettlement } from "../pancakeswap/placementLedger.js";

type PlacementContext =
  | { kind: "signal_pick"; fromOpenTime: number }
  | { kind: "manual_cmd" };

type ConfiguredPancakeBetRun =
  | { outcome: "not_configured" }
  | { outcome: "dryrun"; plainText: string }
  | { outcome: "result"; html: string };

/** Default stake for <code>/placement</code> only (live testing; pre-prediction taps use env). */
const PLACEMENT_TEST_BET_WEI = parseEther("0.0015");

/** Shared by UP/DOWN pick callback and <code>/placement</code>. */
async function runConfiguredPancakeBet(
  direction: "UP" | "DOWN",
  options?: {
    /** If set (e.g. <code>/placement</code>), ignores <code>PANCAKE_PREDICTION_BET_BNB</code>. */
    betWeiOverride?: bigint;
    placementContext?: PlacementContext;
  },
): Promise<ConfiguredPancakeBetRun> {
  const pk = normalizeBscPrivateKey(config.bscWalletPrivateKey);
  const betWei = options?.betWeiOverride ?? config.pancakePredictionBetWei;
  if (betWei > 0n && pk === null && !config.dryRun) {
    console.warn(
      "[telegram] PANCAKE_PREDICTION_BET_BNB set but BSC_WALLET_PRIVATE_KEY missing or invalid",
    );
  }
  if (pk === null || betWei === 0n) return { outcome: "not_configured" };
  if (config.dryRun) {
    return {
      outcome: "dryrun",
      plainText: `[dry-run] Would place Pancake prediction ${direction} for ${formatEther(betWei)} BNB when live round is bettable (no tx)`,
    };
  }
  try {
    const betResult = await placePancakeBnbPredictionBet({
      rpcUrl: config.bscRpcUrl,
      privateKey: pk,
      direction,
      valueWei: betWei,
    });
    if (betResult.ok) {
      let signalId = "UNKNOWN_PLACEMENT";
      let predictionId: string | undefined;
      const ctx = options?.placementContext;
      if (ctx?.kind === "signal_pick") {
        const link = getPlacementLinkForOpenTime(ctx.fromOpenTime);
        signalId = link?.signalId ?? `unknown:${ctx.fromOpenTime}`;
        predictionId = link?.predictionId;
      } else if (ctx?.kind === "manual_cmd") {
        signalId = "MANUAL_PLACEMENT";
      }
      const placementId = randomUUID();
      const betAmountBnb = formatEther(betWei);
      registerPendingPancakeBet({
        placementId,
        signalId,
        ...(predictionId !== undefined ? { predictionId } : {}),
        betAmountBnb,
        epoch: betResult.epoch,
        direction: betResult.direction,
        betTxHash: betResult.txHash,
        valueWei: betResult.valueWei,
        walletAddress: betResult.walletAddress,
      });
    }
    return { outcome: "result", html: formatPancakeBetFollowUpHtml(betResult) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      outcome: "result",
      html: formatPancakeBetFollowUpHtml({ ok: false, message: msg }),
    };
  }
}

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

/** Plain text (no parse_mode) — shows asterisks literally in Telegram. */
export const SIGNAL_REMINDER_ALERT_TEXT = "**Signal Alert** 🔔";

const SIGNAL_REMINDER_COUNT = 5;
const SIGNAL_REMINDER_GAP_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBot(): Telegraf {
  if (!bot) bot = new Telegraf(config.telegramBotToken);
  return bot;
}

/**
 * After signal + pre-prediction, sends {@link SIGNAL_REMINDER_COUNT} plain-text
 * pings spaced by {@link SIGNAL_REMINDER_GAP_MS} (no delay between pings in dry-run).
 */
export async function sendSignalReminderPings(): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) return;
  for (let i = 0; i < SIGNAL_REMINDER_COUNT; i++) {
    if (i > 0 && !config.dryRun) await sleep(SIGNAL_REMINDER_GAP_MS);
    try {
      await sendTelegramText(SIGNAL_REMINDER_ALERT_TEXT);
    } catch (e) {
      console.error("[telegram] signal reminder ping failed", e);
    }
  }
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
  b.command("livecountdown", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const cid = ctx.chat?.id;
    if (cid !== undefined) {
      await ctx.telegram.sendChatAction(cid, "typing");
    }
    const r = await fetchPancakePredictionBnbCountdown(config.bscRpcUrl);
    await ctx.reply(buildLiveCountdownTelegramHtml(r), { parse_mode: "HTML" });
  });
  b.command("fakesignal", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    if (config.dryRun) {
      await ctx.reply(
        "<b>/fakesignal</b> is unavailable in dry-run (Telegram listener is not started).",
        { parse_mode: "HTML" },
      );
      return;
    }
    const raw =
      ctx.message && "text" in ctx.message ? ctx.message.text.trim() : "";
    const tokens = raw.split(/\s+/).filter(Boolean);
    const side = tokens[1]?.toLowerCase();
    if (side !== "up" && side !== "down") {
      await ctx.reply(
        [
          "🎭 <b>/fakesignal</b> — test signal → pre-prediction → pick → Pancake",
          "",
          "Usage:",
          "• <code>/fakesignal up</code>",
          "• <code>/fakesignal down</code>",
          "",
          "Fetches the <b>last closed</b> kline, logs a row to <code>signals.jsonl</code>, queues the same pending prediction the bot uses for real signals (picked up on the <b>next</b> WebSocket candle close), sends this chat the pre-prediction message + UP/DOWN + reminder pings.",
          "If you tap UP/DOWN, Pancake placement uses <b>0.0015 BNB</b> (same as <code>/placement</code>), not <code>PANCAKE_PREDICTION_BET_BNB</code>.",
          "<i>Avoid using while a real signal is already waiting for the next candle.</i>",
        ].join("\n"),
        { parse_mode: "HTML" },
      );
      return;
    }
    const predicted = side === "up" ? "UP" : "DOWN";
    const cid = ctx.chat?.id;
    if (cid !== undefined) await ctx.telegram.sendChatAction(cid, "typing");
    let hist;
    try {
      hist = await fetchKlines(config.symbol, config.interval, 3);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await ctx.reply(`Could not fetch klines: <code>${msg}</code>`, {
        parse_mode: "HTML",
      });
      return;
    }
    if (hist.length < 1) {
      await ctx.reply("No kline data returned from Binance.");
      return;
    }
    const bar = hist.length >= 2 ? hist[hist.length - 2]! : hist[hist.length - 1]!;
    const predictionId = randomUUID();
    const signalId = `${bar.openTime}-${predicted}-${FAKE_SIGNAL_SETUP}`;
    const reason = "Telegram /fakesignal test command";
    enqueueFakeSignalForNextTick({
      signalId,
      predictionId,
      predicted,
      fromOpenTime: bar.openTime,
      fromSetup: FAKE_SIGNAL_SETUP,
      baselineClose: bar.close,
    });
    registerAwaitingHumanPick(bar.openTime, {
      signalId,
      predictionId,
      betWeiOverride: PLACEMENT_TEST_BET_WEI,
    });
    appendSignalLog({
      signalId,
      predictionId,
      ts: new Date().toISOString(),
      openTime: bar.openTime,
      price: bar.close,
      signal: predicted,
      setup: FAKE_SIGNAL_SETUP,
      reason,
    });
    const preHtml = formatPrePredictionTelegramLog({
      pair: config.symbol,
      signalId,
      fromOpenTime: bar.openTime,
      baselineClose: bar.close,
      predicted,
      setup: FAKE_SIGNAL_SETUP,
      reason,
    });
    await sendTelegramText(
      [
        "🎭 <b>FAKE SIGNAL</b> <i>(test)</i> — same buttons and reminders as live.",
        "",
        preHtml,
      ].join("\n"),
      {
        parseMode: "HTML",
        replyMarkup: prePredictionReplyMarkup(bar.openTime),
      },
    );
    await sendSignalReminderPings();
  });
  b.command("placement", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (chatId !== config.telegramChatId) {
      await ctx.reply("Unauthorized chat for this bot instance.");
      return;
    }
    const text = ctx.message && "text" in ctx.message ? ctx.message.text.trim() : "";
    const tokens = text.split(/\s+/).filter(Boolean);
    const side = tokens[1]?.toLowerCase();
    if (side !== "up" && side !== "down") {
      await ctx.reply(
        [
          "🧪 <b>/placement</b> — test Pancake BNB prediction",
          "",
          "Usage:",
          "• <code>/placement up</code> → <code>betBull</code> (same as tap UP)",
          "• <code>/placement down</code> → <code>betBear</code> (same as tap DOWN)",
          "",
          "Needs <code>BSC_WALLET_PRIVATE_KEY</code> only — test stake is fixed at <b>0.0015 BNB</b> (not <code>PANCAKE_PREDICTION_BET_BNB</code>).",
          "Only bets if <code>currentEpoch</code> is <b>open for betting</b> right now. If locked, you get ❌ — we do <b>not</b> wait for the next round.",
          "Reply: ✅ success or ❌ failure (same as after a pre-prediction tap).",
        ].join("\n"),
        { parse_mode: "HTML" },
      );
      return;
    }
    const direction = side === "up" ? "UP" : "DOWN";
    const cid = ctx.chat?.id;
    if (cid !== undefined) await ctx.telegram.sendChatAction(cid, "typing");
    const runBet = await runConfiguredPancakeBet(direction, {
      betWeiOverride: PLACEMENT_TEST_BET_WEI,
      placementContext: { kind: "manual_cmd" },
    });
    if (runBet.outcome === "not_configured") {
      await ctx.reply(
        [
          "⚠️ <b>Placement test</b>",
          "",
          "Set <code>BSC_WALLET_PRIVATE_KEY</code> in <code>.env</code>.",
          "Stake for this command is always <b>0.0015 BNB</b> — you do not need <code>PANCAKE_PREDICTION_BET_BNB</code>.",
        ].join("\n"),
        { parse_mode: "HTML" },
      );
      return;
    }
    if (runBet.outcome === "dryrun") {
      await ctx.reply(
        [
          "🧪 <b>/placement</b> <i>(dry-run)</i>",
          "",
          `<code>${runBet.plainText}</code>`,
          "",
          "<i>No transaction — app is in dry-run mode.</i>",
        ].join("\n"),
        { parse_mode: "HTML" },
      );
      return;
    }
    const label = direction === "UP" ? "up" : "down";
    await ctx.reply(
      [`🧪 <b>Placement test</b> <code>/placement ${label}</code>`, "", runBet.html].join("\n"),
      { parse_mode: "HTML" },
    );
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

    const claimMatch = /^pclaim:(\d+)$/.exec(data);
    if (claimMatch) {
      const chatId = String(ctx.chat?.id ?? "");
      if (chatId !== config.telegramChatId) {
        await ctx.answerCbQuery("Unauthorized");
        return;
      }
      const epochStr = claimMatch[1]!;
      const row = getPancakeBet(epochStr);
      if (!row || row.phase !== "awaiting_claim") {
        await ctx.answerCbQuery("Nothing to claim for this epoch");
        return;
      }
      const pk = normalizeBscPrivateKey(config.bscWalletPrivateKey);
      if (pk === null) {
        await ctx.answerCbQuery("Wallet not configured");
        return;
      }
      await ctx.answerCbQuery("Submitting claim…");
      const res = await claimPancakePredictionEpochs({
        rpcUrl: config.bscRpcUrl,
        privateKey: pk,
        epochs: [BigInt(epochStr)],
      });
      if (res.ok) {
        const outcome = row.awaitingOutcome === "refund" ? "refund" : "won";
        let claimWei = res.claimAmountWei;
        if (claimWei === 0n && row.estimatedClaimWei) {
          claimWei = BigInt(row.estimatedClaimWei);
        }
        await appendPancakePlacementSettlement({
          row,
          outcome,
          claimWei,
          claimTxHash: res.txHash,
        });
        removePancakeBet(epochStr);
      }
      await sendTelegramText(
        formatPancakeClaimTelegramHtml(epochStr, res, {
          placementId: row.placementId,
        }),
        { parseMode: "HTML" },
      );
      return;
    }

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

      const pickLink = getPlacementLinkForOpenTime(fromOpenTime);
      const runBet = await runConfiguredPancakeBet(dir, {
        betWeiOverride: pickLink?.betWeiOverride,
        placementContext: { kind: "signal_pick", fromOpenTime },
      });
      if (runBet.outcome === "not_configured") return;
      if (runBet.outcome === "dryrun") {
        await sendTelegramText(runBet.plainText);
        return;
      }
      try {
        await sendTelegramText(runBet.html, { parseMode: "HTML" });
      } catch (sendErr) {
        console.error("[telegram] could not send bet outcome to chat", sendErr);
      }
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
  startPancakeOutcomePoller(sendTelegramText);
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
