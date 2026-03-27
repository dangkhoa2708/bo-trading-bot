import type { Candle, StrategyResult } from "../types.js";
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

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
): string {
  const icon = result.signal === "UP" ? "🟢" : result.signal === "DOWN" ? "🔴" : "⚪️";
  const timeText = fmtGmt7(c.openTime);
  return [
    `${icon} <b>Signal</b> <code>${escapeHtml(result.signal)}</code> <b>${escapeHtml(result.setup)}</b>`,
    `<b>Pair</b>: <code>${escapeHtml(pair)}</code>`,
    `<b>Time</b>: <code>${escapeHtml(timeText)}</code> <i>(GMT+7)</i>`,
    `<b>Price</b>: <code>${fmtPrice(c.close)}</code>`,
    `<b>ID</b>: <code>${escapeHtml(signalId)}</code>`,
    `<b>Reason</b>: <i>${escapeHtml(result.reason)}</i>`,
    "",
    `${drawTelegramVerticalCandle(c)}`,
  ].join("\n");
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
  return [
    `${icon} <b>Pre‑prediction</b>`,
    `<b>Pair</b>: <code>${escapeHtml(args.pair)}</code>`,
    `<b>From</b>: <code>${escapeHtml(timeText)}</code> <i>(GMT+7)</i>`,
    `<b>Predict next</b>: <code>${escapeHtml(args.predicted)}</code>  <b>${escapeHtml(args.setup)}</b>`,
    `<b>Baseline close</b>: <code>${fmtPrice(args.baselineClose)}</code>`,
    `<b>ID</b>: <code>${escapeHtml(args.signalId)}</code>`,
    `<b>Reason</b>: <i>${escapeHtml(args.reason)}</i>`,
  ].join("\n");
}

export function formatPostPredictionTelegramLog(args: {
  pair: string;
  signalId: string;
  fromOpenTime: number;
  baselineClose: number;
  nextOpenTime: number;
  nextClose: number;
  expected: "UP" | "DOWN";
  actual: "UP" | "DOWN" | "FLAT";
  result: "RIGHT" | "WRONG";
  setup: string;
}): string {
  const ok = args.result === "RIGHT";
  const icon = ok ? "✅" : "❌";
  const fromText = fmtGmt7(args.fromOpenTime);
  const nextText = fmtGmt7(args.nextOpenTime);
  return [
    `${icon} <b>Post‑prediction</b> <b>${ok ? "RIGHT" : "WRONG"}</b>`,
    `<b>Pair</b>: <code>${escapeHtml(args.pair)}</code>`,
    `<b>From</b>: <code>${escapeHtml(fromText)}</code> → <b>Next</b>: <code>${escapeHtml(nextText)}</code> <i>(GMT+7)</i>`,
    `<b>Expected</b>: <code>${escapeHtml(args.expected)}</code>  <b>Actual</b>: <code>${escapeHtml(args.actual)}</code>`,
    `<b>Baseline</b>: <code>${fmtPrice(args.baselineClose)}</code>  <b>Next close</b>: <code>${fmtPrice(args.nextClose)}</code>`,
    `<b>Setup</b>: <code>${escapeHtml(args.setup)}</code>`,
    `<b>ID</b>: <code>${escapeHtml(args.signalId)}</code>`,
  ].join("\n");
}
