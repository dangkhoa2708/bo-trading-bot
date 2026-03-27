import type { Candle } from "../types.js";

export function emaLast(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return ema;
}

export function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

export function range(c: Candle): number {
  return c.high - c.low;
}

export function isGreen(c: Candle): boolean {
  return c.close > c.open;
}

export function isRed(c: Candle): boolean {
  return c.close < c.open;
}

export function upperWick(c: Candle): number {
  const top = Math.max(c.open, c.close);
  return c.high - top;
}

export function lowerWick(c: Candle): number {
  const bot = Math.min(c.open, c.close);
  return bot - c.low;
}

export function avgBody(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let s = 0;
  for (const c of candles) s += body(c);
  return s / candles.length;
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function trueRange(curr: Candle, prevClose: number): number {
  const hl = curr.high - curr.low;
  const hc = Math.abs(curr.high - prevClose);
  const lc = Math.abs(curr.low - prevClose);
  return Math.max(hl, hc, lc);
}

/**
 * Returns the latest simple ATR over `period`.
 * Requires at least period+1 candles (for previous close references).
 */
export function atrLast(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = candles.length - period; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;
    trs.push(trueRange(curr, prev.close));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}
