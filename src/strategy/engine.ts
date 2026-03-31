import { config } from "../config.js";
import type { Candle, StrategyResult } from "../types.js";
import {
  avgBody,
  atrLast,
  body,
  emaLast,
  isGreen,
  isRed,
  lowerWick,
  median,
  range,
  upperWick,
} from "./indicators.js";

function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

function choppy(candles: Candle[]): boolean {
  const n = config.chopLookback;
  if (candles.length < n) return false;
  const tail = candles.slice(-n);
  let changes = 0;
  for (let i = 1; i < tail.length; i++) {
    const a = isGreen(tail[i - 1]!);
    const b = isGreen(tail[i]!);
    if (a !== b) changes++;
  }
  return changes >= n - 1;
}

/** Mirror UP: optional regime filter — EMA20 not in a steep downtrend vs N bars ago. */
function mirrorUpEmaSlopeOk(candles: Candle[]): boolean {
  const n = config.mirrorUpMinEmaSlopeBars;
  if (n <= 0) return true;
  if (candles.length < n + config.emaPeriod + 2) return true;
  const emaNow = emaLast(closes(candles), config.emaPeriod);
  const emaPast = emaLast(closes(candles.slice(0, -n)), config.emaPeriod);
  if (emaNow === null || emaPast === null || emaPast <= 0) return true;
  const slope = (emaNow - emaPast) / emaPast;
  return slope >= config.mirrorUpMinEmaSlopePct;
}

/** Mirror UP: optional — too many recent closes below EMA20 = persistent bearish structure. */
function mirrorUpTooManyClosesBelowEma(candles: Candle[]): boolean {
  const lb = config.mirrorUpBelowEmaLookback;
  const maxBelow = config.mirrorUpMaxClosesBelowEma;
  if (lb <= 0) return false;
  const excludeLast = 3;
  const end = candles.length - excludeLast;
  const start = Math.max(config.emaPeriod, end - lb);
  if (start >= end) return false;
  let count = 0;
  for (let i = start; i < end; i++) {
    const e = emaLast(closes(candles.slice(0, i + 1)), config.emaPeriod);
    if (e !== null && candles[i]!.close < e) count++;
  }
  return count > maxBelow;
}

function lowVolatility(candles: Candle[]): boolean {
  if (candles.length < config.lowVolCompare) return false;
  const tail = candles.slice(-5);
  const ranges = tail.map(range);
  const shortMed = median(ranges);
  const long = candles.slice(-config.lowVolCompare).map(range);
  const longMed = median(long);
  if (longMed === 0) return false;
  return shortMed < longMed * config.lowVolFactor;
}

function atrOutOfBand(
  candles: Candle[],
): { out: boolean; atrPct: number | null } {
  const atr = atrLast(candles, config.atrPeriod);
  if (atr === null) return { out: false, atrPct: null };
  const last = candles[candles.length - 1]!;
  const atrPct = atr / Math.max(last.close, 1e-9);
  if (atrPct < config.minAtrPct) {
    return { out: true, atrPct };
  }
  if (!config.relaxedSignalFilters && atrPct > config.maxAtrPct) {
    return { out: true, atrPct };
  }
  return { out: false, atrPct };
}

function sideways(candles: Candle[], ema: number): boolean {
  const c = candles[candles.length - 1]!;
  const pct = Math.abs(c.close - ema) / c.close;
  return pct < config.sidewaysEmaPct;
}

function strongClose(c: Candle): boolean {
  const r = range(c);
  if (r === 0) return false;
  return body(c) / r >= config.minBodyToRange;
}

function closeNearExtreme(c: Candle, dir: "UP" | "DOWN"): boolean {
  const r = range(c);
  if (r === 0) return false;
  if (dir === "UP") {
    return (c.high - c.close) / r <= config.maxCloseToExtremePct;
  }
  return (c.close - c.low) / r <= config.maxCloseToExtremePct;
}

function exhaustionCloseNearExtreme(
  c: Candle,
  revDir: "UP" | "DOWN",
  exhaustionSignal: "UP" | "DOWN",
): boolean {
  const r = range(c);
  if (r === 0) return false;
  const pct =
    exhaustionSignal === "UP"
      ? config.exhaustionUpRevMaxCloseToExtremePct
      : config.exhaustionRevMaxCloseToExtremePct;
  if (revDir === "UP") {
    return (c.high - c.close) / r <= pct;
  }
  return (c.close - c.low) / r <= pct;
}

function priorSwingLow(candles: Candle[], lookback: number): number | null {
  if (candles.length < lookback + 1) return null;
  const slice = candles.slice(-(lookback + 1), -1);
  return Math.min(...slice.map((c) => c.low));
}

function priorSwingHigh(candles: Candle[], lookback: number): number | null {
  if (candles.length < lookback + 1) return null;
  const slice = candles.slice(-(lookback + 1), -1);
  return Math.max(...slice.map((c) => c.high));
}

function levelBuffer(lastClose: number, atr: number | null): number {
  const pct = lastClose * config.levelNearPricePct;
  if (atr === null || atr <= 0) return pct;
  return Math.max(atr * config.levelNearAtrMult, pct);
}

/**
 * Near support: close or low within buffer of prior swing lows (both sides of level — skip if unsure).
 */
function nearSupport(candles: Candle[], atr: number | null): boolean {
  const last = candles[candles.length - 1]!;
  const buf = levelBuffer(last.close, atr);
  if (buf <= 0) return false;
  const s1 = priorSwingLow(candles, config.levelLookbackShort);
  const s2 = priorSwingLow(candles, config.levelLookbackLong);
  const test = (s: number | null) => {
    if (s === null) return false;
    return (
      Math.abs(last.close - s) <= buf ||
      Math.abs(last.low - s) <= buf
    );
  };
  return test(s1) || test(s2);
}

/**
 * Near resistance: close or high within buffer of prior swing highs.
 */
function nearResistance(candles: Candle[], atr: number | null): boolean {
  const last = candles[candles.length - 1]!;
  const buf = levelBuffer(last.close, atr);
  if (buf <= 0) return false;
  const r1 = priorSwingHigh(candles, config.levelLookbackShort);
  const r2 = priorSwingHigh(candles, config.levelLookbackLong);
  const test = (r: number | null) => {
    if (r === null) return false;
    return (
      Math.abs(last.close - r) <= buf ||
      Math.abs(last.high - r) <= buf
    );
  };
  return test(r1) || test(r2);
}

/**
 * Count consecutive same-direction closes from the last candle; micro opposite
 * bodies (≤ microMax) do not reset the run.
 */
function sameDirectionRunLength(
  candles: Candle[],
  direction: "UP" | "DOWN",
): number {
  if (candles.length === 0) return 0;
  const atr = atrLast(candles, config.atrPeriod);
  const medB = median(candles.slice(-20).map(body));
  const microAtr =
    atr !== null && atr > 0 ? atr * config.momentumMicroPauseBodyAtrMult : Infinity;
  const microMed = medB * config.momentumMicroPauseBodyVsMedianMult;
  const micro = Math.max(Math.min(microAtr, microMed), 1e-9);

  let i = candles.length - 1;
  let count = 0;
  if (direction === "UP") {
    if (!isGreen(candles[i]!)) return 0;
    while (i >= 0) {
      const c = candles[i]!;
      if (isGreen(c)) {
        count++;
        i--;
      } else if (isRed(c) && body(c) <= micro) {
        i--;
      } else {
        break;
      }
    }
  } else {
    if (!isRed(candles[i]!)) return 0;
    while (i >= 0) {
      const c = candles[i]!;
      if (isRed(c)) {
        count++;
        i--;
      } else if (isGreen(c) && body(c) <= micro) {
        i--;
      } else {
        break;
      }
    }
  }
  return count;
}

function mirrorGreenNotSpike(candles: Candle[]): boolean {
  if (config.relaxedSignalFilters) return true;
  const c = candles[candles.length - 1]!;
  const b = body(c);
  const atr = atrLast(candles, config.atrPeriod);
  const lb = Math.min(
    config.mirrorMedianBodyLookback,
    candles.length,
  );
  const hist = candles.slice(-lb);
  const bodiesForMed =
    hist.length >= 2 ? hist.slice(0, -1).map(body) : hist.map(body);
  const med = median(bodiesForMed);
  if (med <= 0) return true;
  if (b > med * config.mirrorMaxGreenBodyVsMedianMult) return false;
  if (atr !== null && atr > 0 && b > atr * config.mirrorMaxGreenBodyAtrMult) {
    return false;
  }
  return true;
}

function exhaustionPassesReconfirm(
  candles: Candle[],
  ex: { signal: "UP" | "DOWN" },
): boolean {
  const applyLevels =
    ex.signal === "DOWN"
      ? config.exhaustionDownApplyLevelReconfirm
      : config.exhaustionUpApplyLevelReconfirm;
  if (!applyLevels) return true;
  const atr = atrLast(candles, config.atrPeriod);
  if (ex.signal === "DOWN" && nearSupport(candles, atr)) return false;
  if (ex.signal === "UP" && nearResistance(candles, atr)) return false;
  return true;
}

/** Raw same-direction bar count in recent window (case 4: extended leg with pauses). */
function sameDirBarsInWindow(candles: Candle[], dir: "UP" | "DOWN"): number {
  const w = Math.min(config.momentumSameDirWindow, candles.length);
  const slice = candles.slice(-w);
  let n = 0;
  for (const c of slice) {
    if (dir === "DOWN" && isRed(c)) n++;
    if (dir === "UP" && isGreen(c)) n++;
  }
  return n;
}

function momentumPassesReconfirm(
  candles: Candle[],
  dir: "UP" | "DOWN",
): boolean {
  const atr = atrLast(candles, config.atrPeriod);
  const runLen = sameDirectionRunLength(candles, dir);
  if (runLen > config.momentumMaxImpulseRun) return false;
  if (config.relaxedSignalFilters) return true;
  // Case 4: extended bearish leg (many reds in window); UP uses run-length only (avoid blocking grinds).
  if (
    dir === "DOWN" &&
    sameDirBarsInWindow(candles, "DOWN") >=
      config.momentumMaxSameDirBarsInWindow
  ) {
    return false;
  }
  if (dir === "DOWN" && nearSupport(candles, atr)) return false;
  if (dir === "UP" && nearResistance(candles, atr)) return false;
  return true;
}

/** Mirror UP: spike cap only (level veto is for Momentum; mirrors often test prior highs). */
function mirrorUpPassesReconfirm(candles: Candle[]): boolean {
  return mirrorGreenNotSpike(candles);
}

/** Mirror DOWN fallback: impulse run only (no level / same-dir window vetoes). */
function mirrorDownPassesReconfirm(candles: Candle[]): boolean {
  const runLen = sameDirectionRunLength(candles, "DOWN");
  const last = candles[candles.length - 1];
  if (!last) return false;
  if (runLen > config.mirrorDownMaxImpulseRun) return false;
  return body(last) / Math.max(range(last), 1e-9) >= config.mirrorDownMinBodyToRange;
}

/** Exported for tests / diagnostics; live path uses {@link evaluate} only. */
export function momentumWindow(
  candles: Candle[],
): { ok: boolean; dir: "UP" | "DOWN"; note: string } {
  if (candles.length < 3 + config.bodyLookback) {
    return { ok: false, dir: "UP", note: "not enough history" };
  }
  const last3 = candles.slice(-3);
  const allGreen = last3.every(isGreen);
  const allRed = last3.every(isRed);
  if (!allGreen && !allRed) {
    return { ok: false, dir: "UP", note: "last 3 not same color" };
  }
  const baseline = candles.slice(-(3 + config.bodyLookback), -3);
  const baseAvg = avgBody(baseline);
  if (baseAvg === 0) return { ok: false, dir: "UP", note: "zero avg body" };
  const baseRangeAvg =
    baseline.reduce((sum, c) => sum + range(c), 0) / baseline.length;
  if (!Number.isFinite(baseRangeAvg) || baseRangeAvg <= 0) {
    return { ok: false, dir: "UP", note: "zero avg range" };
  }

  const dir = allGreen ? "UP" : "DOWN";
  const dojiInner = (c: Candle): boolean => {
    const r = range(c);
    return r > 0 && body(c) / r <= config.momentumDojiMaxBodyToRange;
  };

  for (let i = 0; i < last3.length; i++) {
    const c = last3[i]!;
    const isSignalBar = i === last3.length - 1;
    const useDojiInner =
      config.momentumAllowDojiInnerBars &&
      !isSignalBar &&
      ((dir === "UP" && isGreen(c)) || (dir === "DOWN" && isRed(c))) &&
      dojiInner(c);

    if (useDojiInner) {
      if (range(c) < baseRangeAvg * config.momentumDojiMinRangeVsAvgMult) {
        return { ok: false, dir: "UP", note: "doji inner range vs avg fail" };
      }
      continue;
    }

    if (body(c) < baseAvg * config.momentumBodyVsAvg) {
      return { ok: false, dir: "UP", note: "body vs avg fail" };
    }
    if (range(c) < baseRangeAvg * config.momentumRangeVsAvg) {
      return { ok: false, dir: "UP", note: "range vs avg fail" };
    }
    if (!strongClose(c)) {
      return { ok: false, dir: "UP", note: "wicks too large" };
    }
  }

  for (let i = 0; i < last3.length; i++) {
    const c = last3[i]!;
    const isSignalBar = i === last3.length - 1;
    const useDojiInner =
      config.momentumAllowDojiInnerBars &&
      !isSignalBar &&
      ((dir === "UP" && isGreen(c)) || (dir === "DOWN" && isRed(c))) &&
      dojiInner(c);
    if (!useDojiInner && !closeNearExtreme(c, dir)) {
      return { ok: false, dir: "UP", note: "close not near extreme" };
    }
  }
  return { ok: true, dir, note: "momentum" };
}

function exhaustion(
  candles: Candle[],
  ema: number,
): { ok: boolean; signal: "UP" | "DOWN"; note: string } {
  /** Enough bars for the shorter of the two run rules + baseline (per-direction stricter mins apply inside). */
  const need =
    Math.min(config.exhaustionUpRunMin, config.exhaustionDownRunMin) + 1;
  if (candles.length < need + config.bodyLookback) {
    return { ok: false, signal: "UP", note: "short history" };
  }

  const rev = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2]!;
  const runGreen = isGreen(prev);
  const runRed = isRed(prev);
  if (!runGreen && !runRed) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }

  if (runGreen && !isRed(rev)) return { ok: false, signal: "UP", note: "no exhaustion" };
  if (runRed && !isGreen(rev)) return { ok: false, signal: "UP", note: "no exhaustion" };

  let runLen = 0;
  for (let i = candles.length - 2; i >= 0; i--) {
    const c = candles[i]!;
    if ((runGreen && isGreen(c)) || (runRed && isRed(c))) {
      runLen++;
      continue;
    }
    break;
  }
  const signal: "UP" | "DOWN" = runGreen ? "DOWN" : "UP";
  const runMin =
    signal === "DOWN" ? config.exhaustionDownRunMin : config.exhaustionUpRunMin;
  const maxPrevRangeMult =
    signal === "DOWN"
      ? config.exhaustionDownRevMaxPrevRangeMult
      : config.exhaustionUpRevMaxPrevRangeMult;
  const bodyVsBaselineMult =
    signal === "DOWN"
      ? config.exhaustionDownRevBodyVsBaselineMult
      : config.exhaustionUpRevBodyVsBaselineMult;
  const minBodyToRange =
    signal === "DOWN"
      ? config.exhaustionDownRevMinBodyToRange
      : config.exhaustionUpRevMinBodyToRange;
  if (runLen < runMin) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }

  // Use a bounded recent segment of the run for quality checks, while allowing
  // eligibility from any longer streak (>= EXHAUSTION_RUN_MIN).
  const analysisRunLen = Math.max(runMin, 4);
  const run = candles.slice(-(analysisRunLen + 1), -1);

  const prevRange = range(prev);
  const revRange = range(rev);
  if (prevRange <= 0) return { ok: false, signal: "UP", note: "no exhaustion" };
  const revVsPrev = revRange / prevRange;
  if (
    revVsPrev < config.exhaustionRevMinPrevRangeMult ||
    revVsPrev > maxPrevRangeMult
  ) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }

  const runStart = candles.length - 1 - runLen;
  const baselineStart = Math.max(0, runStart - config.bodyLookback);
  let baseline = candles.slice(baselineStart, runStart);
  if (baseline.length === 0) {
    baseline = candles.slice(-(config.bodyLookback + 1), -1);
  }
  const baseAvg = avgBody(baseline);
  if (baseAvg === 0) return { ok: false, signal: "UP", note: "no exhaustion" };
  if (body(rev) < baseAvg * bodyVsBaselineMult) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }
  if (range(rev) === 0 || body(rev) / range(rev) < minBodyToRange) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }
  const revDir: "UP" | "DOWN" = isGreen(rev) ? "UP" : "DOWN";
  if (!exhaustionCloseNearExtreme(rev, revDir, signal)) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }

  const bodies = run.map(body);
  const weakBodies =
    bodies[0]! > bodies[bodies.length - 1]! ||
    bodies.slice(-2).every((b, i, arr) => i === 0 || b <= arr[i - 1]!);

  const wicks =
    runGreen ? run.map(upperWick) : run.map(lowerWick);
  const wickOk =
    wicks[wicks.length - 1]! >= wicks[wicks.length - 2]! ||
    wicks.slice(-2).reduce((a, b) => a + b, 0) >=
      wicks.slice(0, 2).reduce((a, b) => a + b, 0);

  if (!weakBodies && !wickOk) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }

  if (
    config.exhaustionRequireEmaAlignment &&
    ((signal === "UP" && rev.close <= ema) || (signal === "DOWN" && rev.close >= ema))
  ) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }
  return {
    ok: true,
    signal,
    note: `exhaustion after ${runLen} ${runGreen ? "green" : "red"} + strong ${isGreen(rev) ? "green" : "red"} close`,
  };
}

/** Setup C (part): weak reds + strong green → UP */
function mirrorWeakRedStrongGreen(
  candles: Candle[],
  ema: number,
): { ok: boolean; note: string } {
  if (candles.length < 6) return { ok: false, note: "short" };
  const last3 = candles.slice(-3);
  const [a, b, c] = last3;
  if (!a || !b || !c) return { ok: false, note: "" };
  if (!isGreen(c) || !isRed(a) || !isRed(b)) return { ok: false, note: "" };

  // Guard 1: avoid Mirror UP when price is still meaningfully below EMA20.
  const minClose = ema * (1 - config.mirrorUpMaxBelowEmaPct);
  if (c.close < minClose) return { ok: false, note: "" };

  if (config.mirrorUpApplyChoppyVeto && choppy(candles)) {
    return { ok: false, note: "" };
  }
  if (!mirrorUpEmaSlopeOk(candles)) return { ok: false, note: "" };
  if (mirrorUpTooManyClosesBelowEma(candles)) return { ok: false, note: "" };

  // Guard 2: avoid Mirror UP right after a big red "dump" candle (vs ATR).
  const atr = atrLast(candles, config.atrPeriod);
  const applyDumpVeto =
    (!config.relaxedSignalFilters || config.mirrorUpApplyDumpVetoWhenRelaxed) &&
    atr !== null &&
    atr > 0;
  if (applyDumpVeto) {
    const lookback = Math.max(0, config.mirrorDumpLookback);
    const excludeLast3Start = Math.max(0, candles.length - 3 - lookback);
    const tail = candles.slice(excludeLast3Start, candles.length - 3);
    const hadDump = tail.some(
      (x) => isRed(x) && range(x) >= atr * config.mirrorUpDumpAtrMult,
    );
    if (hadDump) return { ok: false, note: "" };
  }

  const weakening = body(a) > body(b);
  const weakRedBody =
    body(b) < range(b) * config.mirrorUpWeakRedBodyRangePct;
  const prevRedBody = Math.max(body(b), 1e-9);
  const reclaimPrevRedBodyPct = (c.close - b.close) / prevRedBody;
  const strongGreen =
    body(c) / Math.max(range(c), 1e-9) >= config.mirrorUpMinGreenBodyToRange &&
    body(c) >= body(b) * config.mirrorUpMinGreenBodyVsPrevRedMult &&
    reclaimPrevRedBodyPct >= config.mirrorUpMinReclaimPrevRedBodyPct;
  if (weakening && weakRedBody && strongGreen && closeNearExtreme(c, "UP")) {
    return { ok: true, note: "Setup C: weakening reds + strong green" };
  }
  return { ok: false, note: "" };
}

export function evaluate(candles: Candle[]): StrategyResult {
  const min = Math.max(config.emaPeriod + 2, 25);
  if (candles.length < min) {
    return { signal: "NONE", setup: "None", reason: "warming up candles" };
  }

  const ema = emaLast(closes(candles), config.emaPeriod);
  if (ema === null) {
    return { signal: "NONE", setup: "None", reason: "ema unavailable" };
  }

  if (!config.relaxedSignalFilters && choppy(candles)) {
    return { signal: "NONE", setup: "None", reason: "choppy / alternating" };
  }
  const atrBand = atrOutOfBand(candles);
  if (atrBand.out) {
    return {
      signal: "NONE",
      setup: "None",
      reason: `atr out of band (${(atrBand.atrPct! * 100).toFixed(3)}%)`,
    };
  }
  if (!config.relaxedSignalFilters && lowVolatility(candles)) {
    return { signal: "NONE", setup: "None", reason: "low volatility" };
  }
  if (!config.relaxedSignalFilters && sideways(candles, ema)) {
    return { signal: "NONE", setup: "None", reason: "sideways vs EMA" };
  }

  const last = candles[candles.length - 1]!;

  const ex = exhaustion(candles, ema);
  if (ex.ok && exhaustionPassesReconfirm(candles, ex)) {
    return {
      signal: ex.signal,
      setup: "Exhaustion",
      reason: ex.note,
    };
  }

  const mirUp = mirrorWeakRedStrongGreen(candles, ema);
  if (mirUp.ok && mirrorUpPassesReconfirm(candles)) {
    return { signal: "UP", setup: "Mirror", reason: mirUp.note };
  }

  const mom = momentumWindow(candles);
  if (mom.ok) {
    if (mom.dir === "UP" && last.close > ema) {
      if (!momentumPassesReconfirm(candles, "UP")) {
        return {
          signal: "NONE",
          setup: "None",
          reason: "reconfirm: momentum UP blocked (impulse or levels)",
        };
      }
      return {
        signal: "UP",
        setup: "Momentum",
        reason: "3 strong greens, close > EMA20",
      };
    }
    if (mom.dir === "DOWN" && last.close < ema) {
      if (!momentumPassesReconfirm(candles, "DOWN")) {
        return {
          signal: "NONE",
          setup: "None",
          reason: "reconfirm: momentum DOWN blocked (impulse or levels)",
        };
      }
      return {
        signal: "DOWN",
        setup: "Momentum",
        reason: "3 strong reds, close < EMA20",
      };
    }
    if (mom.dir === "DOWN") {
      const mirrorOk = config.mirrorDownLightReconfirm
        ? mirrorDownPassesReconfirm(candles)
        : momentumPassesReconfirm(candles, "DOWN");
      if (!mirrorOk) {
        return {
          signal: "NONE",
          setup: "None",
          reason: config.mirrorDownLightReconfirm
            ? "reconfirm: mirror DOWN blocked (impulse run)"
            : "reconfirm: mirror DOWN blocked (impulse or levels)",
        };
      }
      return {
        signal: "DOWN",
        setup: "Mirror",
        reason: "Setup C: strong red momentum (no EMA side filter)",
      };
    }
    return {
      signal: "NONE",
      setup: "None",
      reason: "momentum filtered by EMA",
    };
  }

  return { signal: "NONE", setup: "None", reason: "no setup" };
}
