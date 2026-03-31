/**
 * Mirror-only backtest (next-candle scoring), with optional strict Mirror dedupe.
 *
 * Usage:
 * - `npx tsx scripts/run-mirror-backtest.ts 90`
 */
import { fetchKlinesRange } from "../src/binance/rest.js";
import { config } from "../src/config.js";
import { evaluate } from "../src/strategy/engine.js";
import { SignalDispatcher } from "../src/signal/dispatcher.js";
import type { Candle } from "../src/types.js";

const MS_DAY = 24 * 60 * 60 * 1000;
const WARMUP_BEFORE_WINDOW_MS = 1 * MS_DAY;
const RESOLVE_TAIL_MS = 2 * MS_DAY;

function clampDays(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 90;
  return Math.max(1, Math.min(90, parseInt(raw, 10)));
}

function pct(right: number, total: number): string {
  return total > 0 ? `${((right / total) * 100).toFixed(1)}%` : "—";
}

const days = clampDays(process.argv[2]);

// Mirror “strict mode” (as used historically): strict same-direction dedupe for Mirror.
config.mirrorAllowRepeatSameDirection = false;

const now = Date.now();
const windowEndMs = now;
const windowStartMs = windowEndMs - days * MS_DAY;
const fetchStartMs = windowStartMs - WARMUP_BEFORE_WINDOW_MS;
const fetchEndMs = windowEndMs + RESOLVE_TAIL_MS;

const all = await fetchKlinesRange(
  config.symbol,
  config.interval,
  fetchStartMs,
  fetchEndMs,
);
if (all.length === 0) {
  console.error("No klines returned from Binance.");
  process.exit(1);
}

const candles: Candle[] = [];
const dispatcher = new SignalDispatcher();

let pending: { predicted: "UP" | "DOWN"; fromOpenTime: number; baselineClose: number } | null =
  null;

let total = 0;
let right = 0;
let wrong = 0;
let upT = 0;
let upR = 0;
let upW = 0;
let downT = 0;
let downR = 0;
let downW = 0;

for (const c of all) {
  if (pending) {
    const actual: "UP" | "DOWN" | "FLAT" =
      c.close > pending.baselineClose
        ? "UP"
        : c.close < pending.baselineClose
          ? "DOWN"
          : "FLAT";
    if (pending.fromOpenTime >= windowStartMs && pending.fromOpenTime <= windowEndMs) {
      total++;
      const ok = actual === pending.predicted;
      if (ok) right++;
      else wrong++;
      if (pending.predicted === "UP") {
        upT++;
        if (ok) upR++;
        else upW++;
      } else {
        downT++;
        if (ok) downR++;
        else downW++;
      }
    }
    pending = null;
  }

  const last = candles[candles.length - 1];
  if (last && last.openTime === c.openTime) candles[candles.length - 1] = c;
  else candles.push(c);
  while (candles.length > config.candleBuffer) candles.shift();

  if (c.openTime < windowStartMs || c.openTime > windowEndMs) continue;

  const r = evaluate(candles);
  if (r.signal === "NONE" || r.setup !== "Mirror") continue;
  const d = dispatcher.shouldEmit(c.openTime, r);
  if (!d.emit) continue;

  pending = { predicted: r.signal, fromOpenTime: c.openTime, baselineClose: c.close };
}

console.log(`🪞 Mirror backtest (strict dedupe) — last ${days} day(s)`);
console.log(`• Pair/TF: ${config.symbol} ${config.interval}`);
console.log(`• Total: ${total} (✅ ${right} / ❌ ${wrong}) — ${pct(right, total)}`);
console.log(`• UP: ${upT} (✅ ${upR} / ❌ ${upW}) — ${pct(upR, upT)}`);
console.log(`• DOWN: ${downT} (✅ ${downR} / ❌ ${downW}) — ${pct(downR, downT)}`);
