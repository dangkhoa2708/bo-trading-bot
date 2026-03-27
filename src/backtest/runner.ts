import { fetchKlinesRange } from "../binance/rest.js";
import { config } from "../config.js";
import { evaluate } from "../strategy/engine.js";
import { SignalDispatcher } from "../signal/dispatcher.js";
import type { Candle } from "../types.js";
import { fmtGmt7 } from "../time/utils.js";

const MS_DAY = 24 * 60 * 60 * 1000;

/** Fetch and evaluate the last N days of closed klines only (no extra history). */
export const BACKTEST_WINDOW_DAYS = 3;

export type BacktestEmittedRow = {
  time: string;
  signal: string;
  setup: string;
  reason: string;
};

export type BacktestResult = {
  ok: true;
  pair: string;
  interval: string;
  windowStartMs: number;
  windowEndMs: number;
  windowLabelGmt7: string;
  candleCount: number;
  /** Strategy returned UP/DOWN inside window (before dispatcher). */
  rawSignals: number;
  /** Would have been sent after SignalDispatcher (same as live). */
  emitted: number;
  emittedUp: number;
  emittedDown: number;
  /** UP/DOWN seen from evaluate but not emitted (dedupe / same candle). */
  skippedByDispatcher: number;
  bySetup: Record<string, number>;
  rows: BacktestEmittedRow[];
};

export type BacktestError = { ok: false; message: string };

function trimBuffer(candles: Candle[], max: number): void {
  while (candles.length > max) candles.shift();
}

export async function runBacktest(): Promise<BacktestResult | BacktestError> {
  const endMs = Date.now();
  const windowStartMs = endMs - BACKTEST_WINDOW_DAYS * MS_DAY;

  let all: Candle[];
  try {
    all = await fetchKlinesRange(config.symbol, config.interval, windowStartMs, endMs);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  if (all.length === 0) {
    return { ok: false, message: "No klines returned from Binance." };
  }

  const candles: Candle[] = [];
  const dispatcher = new SignalDispatcher();

  let rawSignals = 0;
  let emitted = 0;
  let emittedUp = 0;
  let emittedDown = 0;
  let skippedByDispatcher = 0;
  const bySetup = new Map<string, number>();
  const rows: BacktestEmittedRow[] = [];

  for (const c of all) {
    candles.push(c);
    trimBuffer(candles, config.candleBuffer);

    const result = evaluate(candles);
    const decision = dispatcher.shouldEmit(c.openTime, result);

    if (result.signal !== "NONE") {
      rawSignals++;
    }

    if (result.signal === "NONE") {
      continue;
    }

    if (!decision.emit) {
      skippedByDispatcher++;
      continue;
    }

    emitted++;
    if (result.signal === "UP") emittedUp++;
    if (result.signal === "DOWN") emittedDown++;
    bySetup.set(result.setup, (bySetup.get(result.setup) ?? 0) + 1);
    rows.push({
      time: fmtGmt7(c.openTime),
      signal: result.signal,
      setup: result.setup,
      reason: result.reason,
    });
  }

  return {
    ok: true,
    pair: config.symbol,
    interval: config.interval,
    windowStartMs,
    windowEndMs: endMs,
    windowLabelGmt7: `${fmtGmt7(windowStartMs)} → ${fmtGmt7(endMs)}`,
    candleCount: all.length,
    rawSignals,
    emitted,
    emittedUp,
    emittedDown,
    skippedByDispatcher,
    bySetup: Object.fromEntries([...bySetup.entries()].sort((a, b) => b[1] - a[1])),
    rows,
  };
}
