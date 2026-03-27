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
  if (atrPct < config.minAtrPct || atrPct > config.maxAtrPct) {
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

function momentumWindow(
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

  for (const c of last3) {
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
  const dir = allGreen ? "UP" : "DOWN";
  if (!last3.every((c) => closeNearExtreme(c, dir))) {
    return { ok: false, dir: "UP", note: "close not near extreme" };
  }
  return { ok: true, dir, note: "momentum" };
}

function exhaustion(
  candles: Candle[],
): { ok: boolean; signal: "UP" | "DOWN"; note: string } {
  const need = config.exhaustionRunMin + 1;
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
  if (runLen < config.exhaustionRunMin) {
    return { ok: false, signal: "UP", note: "no exhaustion" };
  }

  // Use a bounded recent segment of the run for quality checks, while allowing
  // eligibility from any longer streak (>= EXHAUSTION_RUN_MIN).
  const analysisRunLen = Math.max(config.exhaustionRunMin, 4);
  const run = candles.slice(-(analysisRunLen + 1), -1);

  const prevRange = range(prev);
  const revRange = range(rev);
  if (prevRange <= 0) return { ok: false, signal: "UP", note: "no exhaustion" };
  const revVsPrev = revRange / prevRange;
  if (
    revVsPrev < config.exhaustionRevMinPrevRangeMult ||
    revVsPrev > config.exhaustionRevMaxPrevRangeMult
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
  if (body(rev) < baseAvg * 1.0) return { ok: false, signal: "UP", note: "no exhaustion" };
  if (!strongClose(rev)) return { ok: false, signal: "UP", note: "no exhaustion" };
  const revDir: "UP" | "DOWN" = isGreen(rev) ? "UP" : "DOWN";
  if (!closeNearExtreme(rev, revDir)) return { ok: false, signal: "UP", note: "no exhaustion" };

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

  const signal: "UP" | "DOWN" = runGreen ? "DOWN" : "UP";
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
  const minClose = ema * (1 - config.mirrorMaxBelowEmaPct);
  if (c.close < minClose) return { ok: false, note: "" };

  // Guard 2: avoid Mirror UP right after a big red "dump" candle (vs ATR).
  const atr = atrLast(candles, config.atrPeriod);
  if (atr !== null && atr > 0) {
    const lookback = Math.max(0, config.mirrorDumpLookback);
    const excludeLast3Start = Math.max(0, candles.length - 3 - lookback);
    const tail = candles.slice(excludeLast3Start, candles.length - 3);
    const hadDump = tail.some(
      (x) => isRed(x) && range(x) >= atr * config.mirrorDumpAtrMult,
    );
    if (hadDump) return { ok: false, note: "" };
  }

  const weakening = body(a) > body(b);
  const weakRedBody = body(b) < range(b) * 0.55;
  const strongGreen = body(c) / range(c) >= config.minBodyToRange;
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

  if (choppy(candles)) {
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
  if (lowVolatility(candles)) {
    return { signal: "NONE", setup: "None", reason: "low volatility" };
  }
  if (sideways(candles, ema)) {
    return { signal: "NONE", setup: "None", reason: "sideways vs EMA" };
  }

  const last = candles[candles.length - 1]!;

  const ex = exhaustion(candles);
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
      if (!momentumPassesReconfirm(candles, "DOWN")) {
        return {
          signal: "NONE",
          setup: "None",
          reason: "reconfirm: mirror DOWN blocked (impulse or levels)",
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
