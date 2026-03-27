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
  const need = config.exhaustionRunMax + 1;
  if (candles.length < need + config.bodyLookback) {
    return { ok: false, signal: "UP", note: "short history" };
  }

  for (const runLen of [5, 4]) {
    const rev = candles[candles.length - 1]!;
    const run = candles.slice(-(runLen + 1), -1);
    if (run.length !== runLen) continue;

    const runGreen = run.every(isGreen);
    const runRed = run.every(isRed);
    if (!runGreen && !runRed) continue;

    if (runGreen && !isRed(rev)) continue;
    if (runRed && !isGreen(rev)) continue;

    const prev = run[run.length - 1]!;
    const prevRange = range(prev);
    const revRange = range(rev);
    if (prevRange <= 0) continue;
    const revVsPrev = revRange / prevRange;
    if (
      revVsPrev < config.exhaustionRevMinPrevRangeMult ||
      revVsPrev > config.exhaustionRevMaxPrevRangeMult
    ) {
      continue;
    }

    const baseline = candles.slice(
      -(runLen + 1 + config.bodyLookback),
      -(runLen + 1),
    );
    const baseAvg = avgBody(baseline);
    if (baseAvg === 0) continue;
    if (body(rev) < baseAvg * 1.0) continue;
    if (!strongClose(rev)) continue;
    const revDir: "UP" | "DOWN" = isGreen(rev) ? "UP" : "DOWN";
    if (!closeNearExtreme(rev, revDir)) continue;

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

    if (!weakBodies && !wickOk) continue;

    const signal: "UP" | "DOWN" = runGreen ? "DOWN" : "UP";
    return {
      ok: true,
      signal,
      note: `exhaustion after ${runLen} ${runGreen ? "green" : "red"} + strong ${isGreen(rev) ? "green" : "red"} close`,
    };
  }

  return { ok: false, signal: "UP", note: "no exhaustion" };
}

/** Setup C (part): weak reds + strong green → UP */
function mirrorWeakRedStrongGreen(
  candles: Candle[],
): { ok: boolean; note: string } {
  if (candles.length < 6) return { ok: false, note: "short" };
  const last3 = candles.slice(-3);
  const [a, b, c] = last3;
  if (!a || !b || !c) return { ok: false, note: "" };
  if (!isGreen(c) || !isRed(a) || !isRed(b)) return { ok: false, note: "" };

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
  if (ex.ok) {
    return {
      signal: ex.signal,
      setup: "Exhaustion",
      reason: ex.note,
    };
  }

  const mirUp = mirrorWeakRedStrongGreen(candles);
  if (mirUp.ok) {
    return { signal: "UP", setup: "Mirror", reason: mirUp.note };
  }

  const mom = momentumWindow(candles);
  if (mom.ok) {
    if (mom.dir === "UP" && last.close > ema) {
      return {
        signal: "UP",
        setup: "Momentum",
        reason: "3 strong greens, close > EMA20",
      };
    }
    if (mom.dir === "DOWN" && last.close < ema) {
      return {
        signal: "DOWN",
        setup: "Momentum",
        reason: "3 strong reds, close < EMA20",
      };
    }
    if (mom.dir === "DOWN") {
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
