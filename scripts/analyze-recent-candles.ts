/**
 * One-off: fetch BNBUSDT 5m from Binance, replay evaluate + SignalDispatcher on last N closes.
 * Run: npx tsx scripts/analyze-recent-candles.ts [window=40]
 */
import { fetchKlines } from "../src/binance/rest.js";
import { evaluate } from "../src/strategy/engine.js";
import { SignalDispatcher } from "../src/signal/dispatcher.js";
import { fmtGmt7 } from "../src/time/utils.js";
import { config } from "../src/config.js";

const WINDOW = Math.min(
  1000,
  Math.max(1, Number(process.argv[2]) || 40),
);
const WARMUP = 80;
const total = WINDOW + WARMUP;

const candles = await fetchKlines("BNBUSDT", "5m", total);
const dispatcher = new SignalDispatcher();
const START = candles.length - WINDOW;

console.log(
  `BNBUSDT 5m — last ${WINDOW} closes | warmup bars before window: ${START} | relaxedFilters=${config.relaxedSignalFilters} mirrorRepeat=${config.mirrorAllowRepeatSameDirection} exhaustionRevMax=${config.exhaustionRevMaxPrevRangeMult}\n`,
);

const emits: string[] = [];
for (let i = START; i < candles.length; i++) {
  const slice = candles.slice(0, i + 1);
  const c = candles[i]!;
  const r = evaluate(slice);
  const decision = dispatcher.shouldEmit(c.openTime, r);
  const color = c.close >= c.open ? "+" : "-";
  const line = `${fmtGmt7(c.openTime)} ${color} O${c.open.toFixed(2)} C${c.close.toFixed(2)} R${(c.high - c.low).toFixed(3)} | ${r.signal}/${r.setup} | ${r.reason} | emit=${decision.emit}${decision.reason ? ` (${decision.reason})` : ""}`;
  console.log(line);
  if (decision.emit && r.signal !== "NONE") {
    emits.push(line);
  }
}

console.log("\n--- Telegram would emit ---");
if (emits.length === 0) console.log("(none in this window)");
else emits.forEach((l) => console.log(l));
