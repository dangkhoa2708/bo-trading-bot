/** Debug exhaustion sub-checks for a GMT+7 bar label match. */
import { fetchKlines } from "../src/binance/rest.js";
import {
  avgBody,
  body,
  range,
  upperWick,
} from "../src/strategy/indicators.js";
import { fmtGmt7 } from "../src/time/utils.js";
import { evaluate } from "../src/strategy/engine.js";
import { config } from "../src/config.js";

const label = process.argv[2] ?? "13:15:00";
const candles = await fetchKlines("BNBUSDT", "5m", 150);
const idx = candles.findIndex((c) => fmtGmt7(c.openTime).includes(label));
if (idx < 0) {
  console.log("No bar matching", label, "— recent opens:");
  candles.slice(-6).forEach((c) => console.log(fmtGmt7(c.openTime)));
  process.exit(1);
}

const slice = candles.slice(0, idx + 1);
const rev = slice[slice.length - 1]!;
const prev = slice[slice.length - 2]!;
const analysisRunLen = 4;
const run = slice.slice(-(analysisRunLen + 1), -1);

const prevRange = range(prev);
const revRange = range(rev);
const bodies = run.map(body);
const weakBodies =
  bodies[0]! > bodies[bodies.length - 1]! ||
  bodies.slice(-2).every((b, i, arr) => i === 0 || b <= arr[i - 1]!);
const wicks = run.map(upperWick);
const wickOk =
  wicks[wicks.length - 1]! >= wicks[wicks.length - 2]! ||
  wicks.slice(-2).reduce((a, b) => a + b, 0) >=
    wicks.slice(0, 2).reduce((a, b) => a + b, 0);

console.log("Bar", fmtGmt7(rev.openTime), "evaluate:", evaluate(slice));
console.log("prev O/H/L/C", prev.open, prev.high, prev.low, prev.close);
console.log("rev  O/H/L/C", rev.open, rev.high, rev.low, rev.close);
console.log("prevRange", prevRange, "revRange", revRange, "ratio", revRange / prevRange);
console.log("run segment bodies (4 bars before rev, includes prev):", bodies.map((b) => +b.toFixed(4)));
console.log("weakBodies", weakBodies, "upperWicks", wicks.map((w) => +w.toFixed(4)), "wickOk", wickOk);
console.log("weak OR wick pass:", weakBodies || wickOk);

// Mirror engine baseline for body(rev) >= baseAvg
let runLen = 0;
const runGreen = prev.close > prev.open;
for (let i = slice.length - 2; i >= 0; i--) {
  const c = slice[i]!;
  if (runGreen && c.close > c.open) runLen++;
  else if (!runGreen && c.close < c.open) runLen++;
  else break;
}
const runStart = slice.length - 1 - runLen;
const baselineStart = Math.max(0, runStart - config.bodyLookback);
let baseline = slice.slice(baselineStart, runStart);
if (baseline.length === 0) {
  baseline = slice.slice(-(config.bodyLookback + 1), -1);
}
const baseAvg = avgBody(baseline);
const br = body(rev);
const r = revRange;
const strongClose = r > 0 && br / r >= config.minBodyToRange;
const nearLow =
  r > 0 && (rev.close - rev.low) / r <= config.maxCloseToExtremePct;
const needBody = baseAvg * config.exhaustionRevBodyVsBaselineMult;
console.log(
  "runLen",
  runLen,
  "body(rev)",
  br,
  "need >=",
  needBody,
  "(baseAvg×mult)",
  br >= needBody,
);
console.log("strongClose", strongClose, "minBodyToRange", config.minBodyToRange);
console.log("closeNearExtreme DOWN", nearLow, "maxCloseToExtremePct", config.maxCloseToExtremePct);
