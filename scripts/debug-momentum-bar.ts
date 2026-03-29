/** Why Momentum UP fails (or what preempts it) at a GMT+7 time substring. */
import { fetchKlines } from "../src/binance/rest.js";
import {
  avgBody,
  body,
  emaLast,
  isGreen,
  range,
} from "../src/strategy/indicators.js";
import type { Candle } from "../src/types.js";
import { fmtGmt7 } from "../src/time/utils.js";
import { evaluate } from "../src/strategy/engine.js";
import { config } from "../src/config.js";

function strongClose(c: Candle): boolean {
  const r = range(c);
  if (r === 0) return false;
  return body(c) / r >= config.minBodyToRange;
}

function closeNearExtreme(c: Candle, dir: "UP" | "DOWN"): boolean {
  const r = range(c);
  if (r === 0) return false;
  if (dir === "UP") return (c.high - c.close) / r <= config.maxCloseToExtremePct;
  return (c.close - c.low) / r <= config.maxCloseToExtremePct;
}

const label = process.argv[2] ?? "13:40:00";
const candles = await fetchKlines("BNBUSDT", "5m", 150);
const idx = candles.findIndex((c) => fmtGmt7(c.openTime).includes(label));
if (idx < 0) {
  console.log("No bar matching", label);
  process.exit(1);
}

const slice = candles.slice(0, idx + 1);
const last3 = slice.slice(-3);
const baseline = slice.slice(-(3 + config.bodyLookback), -3);
const baseAvg = avgBody(baseline);
const baseRangeAvg =
  baseline.reduce((s, c) => s + range(c), 0) / baseline.length;
const ema = emaLast(
  slice.map((c) => c.close),
  config.emaPeriod,
);

console.log("Bar", fmtGmt7(slice[slice.length - 1]!.openTime));
console.log("evaluate:", evaluate(slice));
console.log("EMA20", ema, "last close", slice[slice.length - 1]!.close, ">", ema);

console.log("\nLast 3 bars O/C:");
for (const c of last3) {
  console.log(
    fmtGmt7(c.openTime),
    "green?",
    isGreen(c),
    "body",
    body(c).toFixed(4),
    "range",
    range(c).toFixed(4),
    "body/range",
    (body(c) / range(c)).toFixed(3),
  );
}

console.log("\nBaseline avg body", baseAvg, "avg range", baseRangeAvg);
console.log("need body >=", baseAvg * config.momentumBodyVsAvg);
console.log("need range >=", baseRangeAvg * config.momentumRangeVsAvg);

let step = "ok";
for (let i = 0; i < last3.length; i++) {
  const c = last3[i]!;
  const bi = body(c);
  const ri = range(c);
  if (bi < baseAvg * config.momentumBodyVsAvg) {
    step = `bar ${i} body vs avg fail (${bi} < ${baseAvg * config.momentumBodyVsAvg})`;
    break;
  }
  if (ri < baseRangeAvg * config.momentumRangeVsAvg) {
    step = `bar ${i} range vs avg fail (${ri} < ${baseRangeAvg * config.momentumRangeVsAvg})`;
    break;
  }
  if (!strongClose(c)) {
    step = `bar ${i} strongClose fail body/range=${(bi / ri).toFixed(3)} need ${config.minBodyToRange}`;
    break;
  }
}
if (step === "ok" && !last3.every((c) => closeNearExtreme(c, "UP"))) {
  step = "close not near extreme on one of last3";
}
console.log("\nmomentumWindow-style:", step);
