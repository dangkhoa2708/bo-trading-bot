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
    `Reason: <i>${result.reason}</i>`,
    "",
    `${drawTelegramVerticalCandle(c)}`,
  ].join("\n");
}
