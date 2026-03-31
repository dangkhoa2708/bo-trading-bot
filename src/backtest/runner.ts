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

export type LiveEligibleSetup = "Exhaustion" | "Mirror";

export type BacktestOptions = {
  /** Replay length ending at now (default `BACKTEST_WINDOW_DAYS`). */
  days?: number;
  /**
   * Engine setups that count as “live-eligible” for raw signal counting and emission replay.
   * Default: Exhaustion-only (historical Telegram /backtest behavior).
   * Use `["Exhaustion", "Mirror"]` to match `main.ts` when both setups emit.
   */
  eligibleSetups?: LiveEligibleSetup[];
};

export type PredStats = {
  total: number;
  right: number;
  wrong: number;
  winRatePct: number;
};

export type DirectionPredStats = Record<"UP" | "DOWN", PredStats>;

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
  /** Next-candle scores for signals that passed the dispatcher (sent path). */
  predictionTotal: number;
  predictionRight: number;
  predictionWrong: number;
  predictionWinRatePct: number;
  predictionByDirection: DirectionPredStats;
  predictionBySetup: Record<"Momentum" | "Exhaustion" | "Mirror" | "Other", PredStats>;
  /**
   * Next-candle scores for every `evaluate()` UP/DOWN in the window, including
   * bars skipped by the dispatcher (same direction back-to-back, duplicate bar).
   */
  allEnginePredictionTotal: number;
  allEnginePredictionRight: number;
  allEnginePredictionWrong: number;
  allEnginePredictionWinRatePct: number;
  allEnginePredictionByDirection: DirectionPredStats;
  allEnginePredictionBySetup: Record<
    "Momentum" | "Exhaustion" | "Mirror" | "Other",
    PredStats
  >;
  /** Which setups were treated as live-eligible for this run. */
  eligibleSetups: LiveEligibleSetup[];
  rows: BacktestEmittedRow[];
};

export type BacktestError = { ok: false; message: string };

function trimBuffer(candles: Candle[], max: number): void {
  while (candles.length > max) candles.shift();
}

function emptyPred(): PredStats {
  return { total: 0, right: 0, wrong: 0, winRatePct: 0 };
}

function emptyDirectionPred(): DirectionPredStats {
  return { UP: emptyPred(), DOWN: emptyPred() };
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

  const eligibleSetups: LiveEligibleSetup[] =
    options.eligibleSetups && options.eligibleSetups.length > 0
      ? options.eligibleSetups
      : ["Exhaustion"];
  const eligibleSetupSet = new Set<string>(eligibleSetups);

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
    /** False when engine fired but dispatcher skipped (same as live). */
    emitted: boolean;
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

  const allEnginePredictionBySetup: BacktestResult["allEnginePredictionBySetup"] =
    {
      Momentum: emptyPred(),
      Exhaustion: emptyPred(),
      Mirror: emptyPred(),
      Other: emptyPred(),
    };
  const predictionByDirection: DirectionPredStats = emptyDirectionPred();
  const allEnginePredictionByDirection: DirectionPredStats = emptyDirectionPred();

  const isLiveEligibleSignal = (signal: {
    signal: "UP" | "DOWN" | "NONE";
    setup: string;
  }): boolean =>
    signal.signal !== "NONE" && eligibleSetupSet.has(signal.setup);

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

      if (pendingPrediction.emitted) {
        const row = rows.find(
          (r) => r.fromOpenTime === pendingPrediction!.fromOpenTime,
        );
        if (row) {
          row.predictionResult = status;
          row.nextClose = c.close;
        }
      }

      if (
        pendingPrediction.fromOpenTime >= windowStartMs &&
        pendingPrediction.fromOpenTime <= windowEndMs
      ) {
        const b = bucketSetup(pendingPrediction.fromSetup);
        allEnginePredictionBySetup[b].total++;
        allEnginePredictionByDirection[pendingPrediction.predicted].total++;
        if (status === "RIGHT") allEnginePredictionBySetup[b].right++;
        else allEnginePredictionBySetup[b].wrong++;
        if (status === "RIGHT") allEnginePredictionByDirection[pendingPrediction.predicted].right++;
        else allEnginePredictionByDirection[pendingPrediction.predicted].wrong++;
        if (pendingPrediction.emitted) {
          predictionBySetup[b].total++;
          predictionByDirection[pendingPrediction.predicted].total++;
          if (status === "RIGHT") predictionBySetup[b].right++;
          else predictionBySetup[b].wrong++;
          if (status === "RIGHT") predictionByDirection[pendingPrediction.predicted].right++;
          else predictionByDirection[pendingPrediction.predicted].wrong++;
        }
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

    if (isLiveEligibleSignal(result)) {
      rawSignals++;
    }

    if (!isLiveEligibleSignal(result)) {
      continue;
    }

    const signalId = `${c.openTime}-${result.signal}-${result.setup}`;
    const pendingBase = {
      signalId,
      predicted: result.signal,
      fromOpenTime: c.openTime,
      fromSetup: result.setup,
      baselineClose: c.close,
    };

    if (!decision.emit) {
      skippedByDispatcher++;
      pendingPrediction = { ...pendingBase, emitted: false };
      continue;
    }

    emitted++;
    if (result.signal === "UP") emittedUp++;
    if (result.signal === "DOWN") emittedDown++;
    bySetup.set(result.setup, (bySetup.get(result.setup) ?? 0) + 1);

    rows.push({
      fromOpenTime: c.openTime,
      time: fmtGmt7(c.openTime),
      signal: result.signal,
      setup: result.setup,
      reason: result.reason,
      baselineClose: c.close,
    });

    pendingPrediction = { ...pendingBase, emitted: true };
  }

  for (const key of Object.keys(predictionBySetup) as Array<
    keyof typeof predictionBySetup
  >) {
    const b = predictionBySetup[key];
    b.winRatePct = b.total > 0 ? (b.right / b.total) * 100 : 0;
  }
  for (const key of Object.keys(predictionByDirection) as Array<
    keyof typeof predictionByDirection
  >) {
    const b = predictionByDirection[key];
    b.winRatePct = b.total > 0 ? (b.right / b.total) * 100 : 0;
  }

  for (const key of Object.keys(allEnginePredictionBySetup) as Array<
    keyof typeof allEnginePredictionBySetup
  >) {
    const b = allEnginePredictionBySetup[key];
    b.winRatePct = b.total > 0 ? (b.right / b.total) * 100 : 0;
  }
  for (const key of Object.keys(allEnginePredictionByDirection) as Array<
    keyof typeof allEnginePredictionByDirection
  >) {
    const b = allEnginePredictionByDirection[key];
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

  const allEnginePredictionRight = Object.values(allEnginePredictionBySetup).reduce(
    (s, x) => s + x.right,
    0,
  );
  const allEnginePredictionWrong = Object.values(allEnginePredictionBySetup).reduce(
    (s, x) => s + x.wrong,
    0,
  );
  const allEnginePredictionTotal =
    allEnginePredictionRight + allEnginePredictionWrong;
  const allEnginePredictionWinRatePct =
    allEnginePredictionTotal > 0
      ? (allEnginePredictionRight / allEnginePredictionTotal) * 100
      : 0;

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
    predictionByDirection,
    predictionBySetup,
    allEnginePredictionTotal,
    allEnginePredictionRight,
    allEnginePredictionWrong,
    allEnginePredictionWinRatePct,
    allEnginePredictionByDirection,
    allEnginePredictionBySetup,
    eligibleSetups,
    rows,
  };
}
