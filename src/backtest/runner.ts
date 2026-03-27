import { fetchKlinesRange } from "../binance/rest.js";
import { config } from "../config.js";
import { evaluate } from "../strategy/engine.js";
import { SignalDispatcher } from "../signal/dispatcher.js";
import type { Candle } from "../types.js";
import { fmtGmt7 } from "../time/utils.js";

const MS_DAY = 24 * 60 * 60 * 1000;

/** Default length of each backtest window (days). */
export const BACKTEST_WINDOW_DAYS = 3;

/** Extra candles before `windowStart` so EMA/strategy can warm up (5m: 1d ≫ buffer). */
const WARMUP_BEFORE_WINDOW_MS = 1 * MS_DAY;

/** Extra fetch after window end so the last signal’s “next candle” prediction can resolve. */
const RESOLVE_TAIL_MS = 2 * MS_DAY;

export type BacktestOptions = {
  /** Replay length ending at now (default `BACKTEST_WINDOW_DAYS`). */
  days?: number;
};

export type PredStats = {
  total: number;
  right: number;
  wrong: number;
  winRatePct: number;
};

export type BacktestEmittedRow = {
  /** Signal candle open (ms); matches pending resolution. */
  fromOpenTime: number;
  time: string;
  signal: string;
  setup: string;
  reason: string;
  /** Signal candle close (baseline for prediction). */
  baselineClose: number;
  /** Next candle close when resolved. */
  nextClose?: number;
  /** Filled when the next candle closed; omitted if replay ended before resolve. */
  predictionResult?: "RIGHT" | "WRONG";
};

export type BacktestResult = {
  ok: true;
  pair: string;
  interval: string;
  windowStartMs: number;
  windowEndMs: number;
  /** Length of the backtest window (days). */
  days: number;
  windowLabelGmt7: string;
  candleCount: number;
  /** Klines including tail after window (for prediction resolution). */
  candleCountFetched: number;
  /** Strategy returned UP/DOWN (engine only, window bars only). */
  rawSignals: number;
  /** Would have been sent after SignalDispatcher (window bars only). */
  emitted: number;
  emittedUp: number;
  emittedDown: number;
  skippedByDispatcher: number;
  setups: string;
  predictionTotal: number;
  predictionRight: number;
  predictionWrong: number;
  predictionWinRatePct: number;
  predictionBySetup: Record<"Momentum" | "Exhaustion" | "Mirror" | "Other", PredStats>;
  rows: BacktestEmittedRow[];
};

export type BacktestError = { ok: false; message: string };

function trimBuffer(candles: Candle[], max: number): void {
  while (candles.length > max) candles.shift();
}

function emptyPred(): PredStats {
  return { total: 0, right: 0, wrong: 0, winRatePct: 0 };
}

function bucketSetup(
  setup: string,
): "Momentum" | "Exhaustion" | "Mirror" | "Other" {
  if (setup === "Momentum" || setup === "Exhaustion" || setup === "Mirror") {
    return setup;
  }
  return "Other";
}

export async function runBacktest(
  options: BacktestOptions = {},
): Promise<BacktestResult | BacktestError> {
  const days = Math.max(
    1,
    Math.min(90, Math.floor(options.days ?? BACKTEST_WINDOW_DAYS)),
  );

  const now = Date.now();
  const windowEndMs = now;
  const windowStartMs = windowEndMs - days * MS_DAY;
  const fetchStartMs = windowStartMs - WARMUP_BEFORE_WINDOW_MS;
  const fetchEndMs = windowEndMs + RESOLVE_TAIL_MS;

  if (windowStartMs < now - 400 * MS_DAY) {
    return {
      ok: false,
      message: "Backtest window too far in the past; reduce days.",
    };
  }

  let all: Candle[];
  try {
    all = await fetchKlinesRange(
      config.symbol,
      config.interval,
      fetchStartMs,
      fetchEndMs,
    );
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }

  if (all.length === 0) {
    return { ok: false, message: "No klines returned from Binance." };
  }

  const candles: Candle[] = [];
  const dispatcher = new SignalDispatcher();
  let pendingPrediction: {
    signalId: string;
    predicted: "UP" | "DOWN";
    fromOpenTime: number;
    fromSetup: string;
    baselineClose: number;
  } | null = null;

  let rawSignals = 0;
  let emitted = 0;
  let emittedUp = 0;
  let emittedDown = 0;
  let skippedByDispatcher = 0;
  const bySetup = new Map<string, number>();
  const rows: BacktestEmittedRow[] = [];

  const predictionBySetup: BacktestResult["predictionBySetup"] = {
    Momentum: emptyPred(),
    Exhaustion: emptyPred(),
    Mirror: emptyPred(),
    Other: emptyPred(),
  };

  for (const c of all) {
    if (pendingPrediction) {
      const expected = pendingPrediction.predicted;
      const actual: "UP" | "DOWN" | "FLAT" =
        c.close > pendingPrediction.baselineClose
          ? "UP"
          : c.close < pendingPrediction.baselineClose
            ? "DOWN"
            : "FLAT";
      const status = actual === expected ? "RIGHT" : "WRONG";

      const row = rows.find(
        (r) => r.fromOpenTime === pendingPrediction!.fromOpenTime,
      );
      if (row) {
        row.predictionResult = status;
        row.nextClose = c.close;
      }

      if (
        pendingPrediction.fromOpenTime >= windowStartMs &&
        pendingPrediction.fromOpenTime <= windowEndMs
      ) {
        const b = bucketSetup(pendingPrediction.fromSetup);
        predictionBySetup[b].total++;
        if (status === "RIGHT") predictionBySetup[b].right++;
        else predictionBySetup[b].wrong++;
      }
      pendingPrediction = null;
    }

    const last = candles[candles.length - 1];
    if (last && last.openTime === c.openTime) {
      candles[candles.length - 1] = c;
    } else {
      candles.push(c);
    }
    trimBuffer(candles, config.candleBuffer);

    if (c.openTime < windowStartMs) {
      continue;
    }
    if (c.openTime > windowEndMs) {
      continue;
    }

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

    const signalId = `${c.openTime}-${result.signal}-${result.setup}`;
    rows.push({
      fromOpenTime: c.openTime,
      time: fmtGmt7(c.openTime),
      signal: result.signal,
      setup: result.setup,
      reason: result.reason,
      baselineClose: c.close,
    });

    pendingPrediction = {
      signalId,
      predicted: result.signal,
      fromOpenTime: c.openTime,
      fromSetup: result.setup,
      baselineClose: c.close,
    };
  }

  for (const key of Object.keys(predictionBySetup) as Array<
    keyof typeof predictionBySetup
  >) {
    const b = predictionBySetup[key];
    b.winRatePct = b.total > 0 ? (b.right / b.total) * 100 : 0;
  }

  const predictionRight = Object.values(predictionBySetup).reduce(
    (s, x) => s + x.right,
    0,
  );
  const predictionWrong = Object.values(predictionBySetup).reduce(
    (s, x) => s + x.wrong,
    0,
  );
  const predictionTotal = predictionRight + predictionWrong;
  const predictionWinRatePct =
    predictionTotal > 0 ? (predictionRight / predictionTotal) * 100 : 0;

  const setups =
    [...bySetup.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(", ") || "—";

  return {
    ok: true,
    pair: config.symbol,
    interval: config.interval,
    windowStartMs,
    windowEndMs,
    days,
    windowLabelGmt7: `${fmtGmt7(windowStartMs)} → ${fmtGmt7(windowEndMs)}`,
    candleCount: all.filter(
      (k) => k.openTime <= windowEndMs && k.openTime >= windowStartMs,
    ).length,
    candleCountFetched: all.length,
    rawSignals,
    emitted,
    emittedUp,
    emittedDown,
    skippedByDispatcher,
    setups,
    predictionTotal,
    predictionRight,
    predictionWrong,
    predictionWinRatePct,
    predictionBySetup,
    rows,
  };
}
