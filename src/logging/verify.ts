import type { Candle, StrategyResult } from "../types.js";
import {
  PANCAKE_PREDICTION_BNB_PAGE_URL,
} from "../pancakeswap/predictionCountdown.js";
import {
  signalChartLinks,
  tradingViewBinanceUrl,
  type SignalChartLinks,
} from "../chart/externalLinks.js";
import { fmtGmt7WithZoneLabel } from "../time/utils.js";
import {
  candleColor,
  candleStrength,
  drawAsciiCandle,
  drawTelegramVerticalCandle,
} from "../candle/utils.js";
import { fmtGmt7 } from "../time/utils.js";

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
} as const;

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Telegram HTML line: Momentum = low confidence; Exhaustion/Mirror = medium. */
export function setupConfidenceHtmlLine(setup: string): string | null {
  if (setup === "Momentum") {
    return "⚠️ <b>Confidence</b>: <i>LOW</i>";
  }
  if (setup === "Exhaustion" || setup === "Mirror") {
    return "📊 <b>Confidence</b>: <i>MEDIUM</i>";
  }
  return null;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${ANSI.reset}`;
}

function colorizeCandle(c: Candle, ascii: string): string {
  const color = candleColor(c);
  if (color === "GREEN") return colorize(ascii, ANSI.green);
  if (color === "RED") return colorize(ascii, ANSI.red);
  return colorize(ascii, ANSI.yellow);
}

function colorizeEval(evalText: string, result: StrategyResult): string {
  if (result.signal === "UP") return colorize(evalText, ANSI.green);
  if (result.signal === "DOWN") return colorize(evalText, ANSI.red);
  return colorize(evalText, ANSI.gray);
}

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

export function formatVerifyLog(c: Candle, result: StrategyResult): string {
  const candleText = colorizeCandle(c, drawAsciiCandle(c));
  const evalText = colorizeEval(`${result.signal}/${result.setup}`, result);
  const timeText = fmtGmt7(c.openTime);
  const priceText = `O ${fmtPrice(c.open)} -> C ${fmtPrice(c.close)}`;
  return `[candle] ${timeText} | ${priceText} | candle ${candleText} | eval ${evalText} | reason ${result.reason}`;
}

export function formatVerifyTelegramLog(c: Candle, result: StrategyResult): string {
  const cColor = candleColor(c);
  const icon = cColor === "GREEN" ? "🟢" : cColor === "RED" ? "🔴" : "🟡";
  const timeText = fmtGmt7(c.openTime);
  const evalText = `${result.signal}/${result.setup}`;
  const strengthPct = Math.round(candleStrength(c) * 100);
  return [
    `${icon} <b>Candle</b> ${timeText} <i>(GMT+7)</i>`,
    `Open: <code>${fmtPrice(c.open)}</code>  Close: <code>${fmtPrice(c.close)}</code>`,
    `Eval: <b>${evalText}</b>`,
    `Strength: <code>${strengthPct}%</code>`,
    `Reason: <i>${escapeHtml(result.reason)}</i>`,
    "",
    `${drawTelegramVerticalCandle(c)}`,
  ].join("\n");
}

export function formatSignalTelegramLog(
  pair: string,
  c: Candle,
  result: StrategyResult,
  signalId: string,
  options?: {
    extraHtmlBeforeChart?: string;
    includePickPrompt?: boolean;
    baselineCloseOverride?: number;
  },
): string {
  const icon = result.signal === "UP" ? "🟢" : result.signal === "DOWN" ? "🔴" : "⚪️";
  const timeText = fmtGmt7WithZoneLabel(c.openTime);
  const conf = setupConfidenceHtmlLine(result.setup);
  const baselineClose = options?.baselineCloseOverride ?? c.close;
  return [
    `${icon} <b>Signal</b> <code>${escapeHtml(result.signal)}</code> <b>${escapeHtml(result.setup)}</b>  <code>${escapeHtml(signalId)}</code>`,
    ...(conf !== null ? [conf] : []),
    `<b>Pair</b>: <code>${escapeHtml(pair)}</code>`,
    `<b>Candle open</b>: <code>${escapeHtml(timeText)}</code>`,
    `<b>Price</b>: <code>${fmtPrice(c.close)}</code>`,
    `<b>Baseline close</b>: <code>${fmtPrice(baselineClose)}</code>`,
    `<b>ID</b>: <code>${escapeHtml(signalId)}</code>`,
    `<b>Reason</b>: <i>${escapeHtml(result.reason)}</i>`,
    ...(options?.extraHtmlBeforeChart ? [options.extraHtmlBeforeChart] : []),
    ...(options?.includePickPrompt
      ? ["", "<i>Review: tap your expected next close vs baseline.</i>"]
      : []),
  ].join("\n");
}

/** Payload for <code>/chart</code> — same link as signal alerts. */
export function buildChartTestTelegramPayload(
  pair: string,
  interval: string,
): { text: string; replyMarkup: SignalChartLinks["replyMarkup"] } {
  const links = signalChartLinks(pair, interval);
  const text = [
    "🧪 <b>Chart link (test)</b>",
    `<b>Pair</b>: <code>${escapeHtml(pair)}</code>  <b>Interval</b>: <code>${escapeHtml(interval)}</code>`,
    "",
    "Same TradingView URL as signal alerts. Use <code>/chart</code> to verify the button and preview.",
    "",
    `📊 <a href="${escapeHtml(links.tradingViewUrl)}">TradingView</a>`,
    links.tradingViewUrl,
  ].join("\n");
  return { text, replyMarkup: links.replyMarkup };
}

export function formatPrePredictionTelegramLog(args: {
  pair: string;
  signalId: string;
  fromOpenTime: number;
  baselineClose: number;
  predicted: "UP" | "DOWN";
  setup: string;
  reason: string;
}): string {
  const icon = args.predicted === "UP" ? "📈" : "📉";
  const timeText = fmtGmt7(args.fromOpenTime);
  const conf = setupConfidenceHtmlLine(args.setup);
  return [
    `${icon} <b>Pre‑prediction</b>  <code>${escapeHtml(args.signalId)}</code>`,
    ...(conf !== null ? [conf] : []),
    `<b>Pair</b>: <code>${escapeHtml(args.pair)}</code>`,
    `<b>From</b>: <code>${escapeHtml(timeText)}</code> <i>(GMT+7)</i>`,
    `<b>Predict next</b>: <code>${escapeHtml(args.predicted)}</code>  <b>${escapeHtml(args.setup)}</b>`,
    `<b>Baseline close</b>: <code>${fmtPrice(args.baselineClose)}</code>`,
    `<b>ID</b>: <code>${escapeHtml(args.signalId)}</code>`,
    `<b>Reason</b>: <i>${escapeHtml(args.reason)}</i>`,
    "",
    "<i>Review: tap your expected next close vs baseline.</i>",
  ].join("\n");
}

/** Inline keyboard: human pick UP/DOWN for this signal bar (`openTime` ms). */
export function prePredictionReplyMarkup(fromOpenTime: number): {
  inline_keyboard: Array<
    Array<{ text: string; callback_data: string }>
  >;
} {
  return {
    inline_keyboard: [
      [
        {
          text: "👆 My pick: UP",
          callback_data: `pick:${fromOpenTime}:U`,
        },
        {
          text: "👇 My pick: DOWN",
          callback_data: `pick:${fromOpenTime}:D`,
        },
      ],
    ],
  };
}

export function signalReplyMarkup(args: {
  pair: string;
  interval: string;
  fromOpenTime: number;
}): {
  inline_keyboard: Array<
    Array<
      | { text: string; url: string }
      | { text: string; callback_data: string }
    >
  >;
} {
  return {
    inline_keyboard: [
      [
        { text: "⏱ Countdown", url: PANCAKE_PREDICTION_BNB_PAGE_URL },
        {
          text: "📊 TradingView",
          url: tradingViewBinanceUrl(args.pair, args.interval),
        },
      ],
      [
        {
          text: "👆 My pick: UP",
          callback_data: `pick:${args.fromOpenTime}:U`,
        },
        {
          text: "👇 My pick: DOWN",
          callback_data: `pick:${args.fromOpenTime}:D`,
        },
      ],
    ],
  };
}

export function formatPostPredictionTelegramLog(args: {
  pair: string;
  signalId: string;
  fromOpenTime: number;
  baselineClose: number;
  nextOpenTime: number;
  nextClose: number;
  /** Bot / strategy direction. */
  botExpected: "UP" | "DOWN";
  /** User Telegram pick; null if not chosen before resolve. */
  humanPick: "UP" | "DOWN" | null;
  /** Direction used to compute result (human pick or bot fallback). */
  scoredExpected: "UP" | "DOWN";
  actual: "UP" | "DOWN" | "FLAT";
  result: "RIGHT" | "WRONG";
  setup: string;
}): string {
  const ok = args.result === "RIGHT";
  const icon = ok ? "✅" : "❌";
  const fromText = fmtGmt7(args.fromOpenTime);
  const nextText = fmtGmt7(args.nextOpenTime);
  const conf = setupConfidenceHtmlLine(args.setup);
  const humanLine =
    args.humanPick !== null
      ? `<b>Your pick</b>: <code>${escapeHtml(args.humanPick)}</code>`
      : `<b>Your pick</b>: <i>— not recorded (scored vs bot)</i>`;
  const scoreNote =
    args.humanPick !== null
      ? `<i>Result vs your pick</i>`
      : `<i>Result vs bot</i>`;
  return [
    `${icon} <b>Post‑prediction</b> <b>${ok ? "RIGHT" : "WRONG"}</b>  <code>${escapeHtml(args.signalId)}</code>`,
    ...(conf !== null ? [conf] : []),
    scoreNote,
    `<b>Pair</b>: <code>${escapeHtml(args.pair)}</code>`,
    `<b>From</b>: <code>${escapeHtml(fromText)}</code> → <b>Next</b>: <code>${escapeHtml(nextText)}</code> <i>(GMT+7)</i>`,
    `<b>Bot predicted</b>: <code>${escapeHtml(args.botExpected)}</code>`,
    humanLine,
    `<b>Scored as</b>: <code>${escapeHtml(args.scoredExpected)}</code>  <b>Market</b>: <code>${escapeHtml(args.actual)}</code>`,
    `<b>Baseline</b>: <code>${fmtPrice(args.baselineClose)}</code>  <b>Next close</b>: <code>${fmtPrice(args.nextClose)}</code>`,
    `<b>Setup</b>: <code>${escapeHtml(args.setup)}</code>`,
    `<b>ID</b>: <code>${escapeHtml(args.signalId)}</code>`,
  ].join("\n");
}
