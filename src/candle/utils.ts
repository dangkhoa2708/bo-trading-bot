import type { Candle } from "../types.js";
import { body, isGreen, isRed, lowerWick, range, upperWick } from "../strategy/indicators.js";

export type CandleColor = "GREEN" | "RED" | "DOJI";
export type CandleDirection = "UP" | "DOWN" | "NONE";

export function candleColor(c: Candle): CandleColor {
  if (isGreen(c)) return "GREEN";
  if (isRed(c)) return "RED";
  return "DOJI";
}

export function candleDirection(c: Candle): CandleDirection {
  if (isGreen(c)) return "UP";
  if (isRed(c)) return "DOWN";
  return "NONE";
}

export function candleStrength(c: Candle): number {
  const r = Math.max(range(c), 0);
  if (r === 0) return 0;
  return body(c) / r;
}

export function wickLengths(c: Candle): { upper: number; lower: number } {
  return {
    upper: upperWick(c),
    lower: lowerWick(c),
  };
}

/**
 * Flat normalized candle text, e.g. |--GGGG-|
 * - '-' = wick
 * - 'G'/'R'/'D' = body (green/red/doji)
 * Proportions come from real upper/body/lower sizes.
 */
export function drawAsciiCandle(c: Candle): string {
  const color = candleColor(c);
  const r = Math.max(range(c), 0);
  if (r === 0) return "|----D----|";

  const upper = Math.max(upperWick(c), 0);
  const lower = Math.max(lowerWick(c), 0);
  const b = Math.max(body(c), 0);

  const scale = 9;
  let unitsUpper = Math.round((upper / r) * scale);
  let unitsLower = Math.round((lower / r) * scale);
  let unitsBody = Math.max(1, Math.round((b / r) * scale));
  if (color === "DOJI") {
    // Keep doji body visually short.
    unitsBody = 1;
  }
  let total = unitsUpper + unitsBody + unitsLower;
  if (total > scale) unitsBody = Math.max(1, unitsBody - (total - scale));
  total = unitsUpper + unitsBody + unitsLower;
  if (total < scale) {
    const rest = scale - total;
    if (color === "DOJI") {
      unitsUpper += Math.floor(rest / 2);
      unitsLower += rest - Math.floor(rest / 2);
    } else {
      unitsBody += rest;
    }
  }

  const bodyChar = color === "RED" ? "R" : color === "GREEN" ? "G" : "D";
  const u = "-".repeat(unitsUpper);
  const bodyText = bodyChar.repeat(unitsBody);
  const l = "-".repeat(unitsLower);
  return `|${u}${bodyText}${l}|`;
}

/**
 * Telegram-friendly vertical candle in monospace using Unicode blocks.
 * Example:
 * 🟢
 * `   ╽`
 * `   █`
 * `   ╿`
 */
export function drawTelegramVerticalCandle(c: Candle): string {
  const color = candleColor(c);
  const r = Math.max(range(c), 0);
  if (r === 0) return "│\n░\n│";

  const upper = Math.max(upperWick(c), 0);
  const lower = Math.max(lowerWick(c), 0);
  const b = Math.max(body(c), 0);

  // 1) Pick total candle height from absolute body move size.
  //    This makes tiny/medium/long candles look appropriately short/medium/tall.
  const movePct = b / Math.max(c.open, 1e-9);
  const minHeight = 3;
  const maxHeight = 11;
  const fullMoveCapPct = 0.004; // 0.40% body move reaches max visual height
  const moveMag = Math.min(1, movePct / fullMoveCapPct);
  const totalHeight =
    minHeight + Math.round(moveMag * (maxHeight - minHeight));

  // 2) Split that total height by real OHLC proportions.
  const upperRatio = upper / r;
  const bodyRatio = b / r;
  const lowerRatio = lower / r;

  let unitsUpper = Math.round(upperRatio * totalHeight);
  let unitsBody = Math.round(bodyRatio * totalHeight);
  let unitsLower = Math.round(lowerRatio * totalHeight);
  if (color === "DOJI") unitsBody = 1;

  // Keep at least one row for body.
  if (unitsBody < 1) unitsBody = 1;

  // Fix rounding drift so upper+body+lower == totalHeight.
  let total = unitsUpper + unitsBody + unitsLower;
  if (total > totalHeight) {
    let overflow = total - totalHeight;
    const reduceUpper = Math.min(overflow, Math.max(0, unitsUpper));
    unitsUpper -= reduceUpper;
    overflow -= reduceUpper;
    const reduceLower = Math.min(overflow, Math.max(0, unitsLower));
    unitsLower -= reduceLower;
    overflow -= reduceLower;
    if (overflow > 0) unitsBody = Math.max(1, unitsBody - overflow);
  } else if (total < totalHeight) {
    const add = totalHeight - total;
    // Put extra rows into body for stronger readability.
    unitsBody += add;
  }

  const bodyGlyph = color === "GREEN" ? "🟩" : color === "RED" ? "🟥" : "🟨";
  const lines: string[] = [];
  for (let i = 0; i < unitsUpper; i++) lines.push("   │");
  for (let i = 0; i < unitsBody; i++) lines.push(`   ${bodyGlyph}`);
  for (let i = 0; i < unitsLower; i++) lines.push("   │");
  return lines.join("\n");
}
