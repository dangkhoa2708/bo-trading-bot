/**
 * Search Mirror strict-mode filters separately for UP and DOWN.
 *
 * Usage:
 * - `npx tsx scripts/search-mirror-filters.ts 90 up`
 * - `npx tsx scripts/search-mirror-filters.ts 90 up context` — sweep Mirror UP context/regime only
 * - `npx tsx scripts/search-mirror-filters.ts 90 down`
 */
import { fetchKlinesRange } from "../src/binance/rest.js";
import { config } from "../src/config.js";
import { evaluate } from "../src/strategy/engine.js";
import { SignalDispatcher } from "../src/signal/dispatcher.js";
import type { Candle } from "../src/types.js";

const MS_DAY = 24 * 60 * 60 * 1000;
const WARMUP_BEFORE_WINDOW_MS = 1 * MS_DAY;
const RESOLVE_TAIL_MS = 2 * MS_DAY;

type Side = "up" | "down";

type UpCase = {
  name: string;
  mirrorUpMaxBelowEmaPct: number;
  mirrorUpDumpAtrMult: number;
  mirrorUpWeakRedBodyRangePct: number;
  mirrorUpMinGreenBodyToRange: number;
  mirrorUpMinGreenBodyVsPrevRedMult: number;
  mirrorUpMinReclaimPrevRedBodyPct: number;
  mirrorUpApplyDumpVetoWhenRelaxed: boolean;
  mirrorUpApplyChoppyVeto: boolean;
  mirrorUpMinEmaSlopeBars: number;
  mirrorUpMinEmaSlopePct: number;
  mirrorUpBelowEmaLookback: number;
  mirrorUpMaxClosesBelowEma: number;
};

type DownCase = {
  name: string;
  mirrorDownMinBodyToRange: number;
  mirrorDownMaxImpulseRun: number;
};

type Row = {
  name: string;
  total: number;
  winRatePct: number;
  upTotal: number;
  upWinRatePct: number;
  downTotal: number;
  downWinRatePct: number;
};

function clampDays(raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw)) return 90;
  return Math.max(1, Math.min(90, parseInt(raw, 10)));
}

function pct(right: number, total: number): number {
  return total > 0 ? (right / total) * 100 : 0;
}

function replayMirror(all: Candle[], windowStartMs: number, windowEndMs: number): Omit<Row, "name"> {
  const candles: Candle[] = [];
  const dispatcher = new SignalDispatcher();
  let pending: { predicted: "UP" | "DOWN"; fromOpenTime: number; baselineClose: number } | null =
    null;

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

  const total = right + wrong;
  return {
    total,
    winRatePct: pct(right, total),
    upTotal: upT,
    upWinRatePct: pct(upR, upT),
    downTotal: downT,
    downWinRatePct: pct(downR, downT),
  };
}

const days = clampDays(process.argv[2]);
const sideArg = (process.argv[3] ?? "up").toLowerCase();
const side = (sideArg === "down" ? "down" : "up") as Side;
const upContextMode = side === "up" && process.argv[4]?.toLowerCase() === "context";

config.mirrorAllowRepeatSameDirection = false;

const now = Date.now();
const windowEndMs = now;
const windowStartMs = windowEndMs - days * MS_DAY;
const fetchStartMs = windowStartMs - WARMUP_BEFORE_WINDOW_MS;
const fetchEndMs = windowEndMs + RESOLVE_TAIL_MS;

const all = await fetchKlinesRange(config.symbol, config.interval, fetchStartMs, fetchEndMs);
if (all.length === 0) {
  console.error("No klines returned from Binance.");
  process.exit(1);
}

const original = {
  mirrorUpMaxBelowEmaPct: config.mirrorUpMaxBelowEmaPct,
  mirrorUpDumpAtrMult: config.mirrorUpDumpAtrMult,
  mirrorUpWeakRedBodyRangePct: config.mirrorUpWeakRedBodyRangePct,
  mirrorUpMinGreenBodyToRange: config.mirrorUpMinGreenBodyToRange,
  mirrorUpMinGreenBodyVsPrevRedMult: config.mirrorUpMinGreenBodyVsPrevRedMult,
  mirrorUpMinReclaimPrevRedBodyPct: config.mirrorUpMinReclaimPrevRedBodyPct,
  mirrorUpApplyDumpVetoWhenRelaxed: config.mirrorUpApplyDumpVetoWhenRelaxed,
  mirrorUpApplyChoppyVeto: config.mirrorUpApplyChoppyVeto,
  mirrorUpMinEmaSlopeBars: config.mirrorUpMinEmaSlopeBars,
  mirrorUpMinEmaSlopePct: config.mirrorUpMinEmaSlopePct,
  mirrorUpBelowEmaLookback: config.mirrorUpBelowEmaLookback,
  mirrorUpMaxClosesBelowEma: config.mirrorUpMaxClosesBelowEma,
  mirrorDownMinBodyToRange: config.mirrorDownMinBodyToRange,
  mirrorDownMaxImpulseRun: config.mirrorDownMaxImpulseRun,
};

const rows: Row[] = [];

const contextDefaults = (): Pick<
  UpCase,
  | "mirrorUpApplyChoppyVeto"
  | "mirrorUpMinEmaSlopeBars"
  | "mirrorUpMinEmaSlopePct"
  | "mirrorUpBelowEmaLookback"
  | "mirrorUpMaxClosesBelowEma"
> => ({
  mirrorUpApplyChoppyVeto: original.mirrorUpApplyChoppyVeto,
  mirrorUpMinEmaSlopeBars: original.mirrorUpMinEmaSlopeBars,
  mirrorUpMinEmaSlopePct: original.mirrorUpMinEmaSlopePct,
  mirrorUpBelowEmaLookback: original.mirrorUpBelowEmaLookback,
  mirrorUpMaxClosesBelowEma: original.mirrorUpMaxClosesBelowEma,
});

if (side === "up") {
  const upCases: UpCase[] = [];
  if (upContextMode) {
    const belowCases: { lb: number; max: number }[] = [
      { lb: 0, max: 12 },
      { lb: 10, max: 5 },
      { lb: 10, max: 7 },
      { lb: 14, max: 7 },
      { lb: 14, max: 9 },
    ];
    for (const choppyV of [false, true]) {
      for (const slopeBars of [0, 6, 10]) {
        for (const slopePct of [-0.02, -0.008, -0.003, 0]) {
          for (const { lb: belowLb, max: maxBelow } of belowCases) {
            upCases.push({
              name: `choppyVeto${choppyV ? "Y" : "N"} slope${slopeBars}b${(slopePct * 1000).toFixed(0)} belowLb${belowLb} maxBelow${maxBelow}`,
              mirrorUpMaxBelowEmaPct: original.mirrorUpMaxBelowEmaPct,
              mirrorUpDumpAtrMult: original.mirrorUpDumpAtrMult,
              mirrorUpWeakRedBodyRangePct: original.mirrorUpWeakRedBodyRangePct,
              mirrorUpMinGreenBodyToRange: original.mirrorUpMinGreenBodyToRange,
              mirrorUpMinGreenBodyVsPrevRedMult: original.mirrorUpMinGreenBodyVsPrevRedMult,
              mirrorUpMinReclaimPrevRedBodyPct: original.mirrorUpMinReclaimPrevRedBodyPct,
              mirrorUpApplyDumpVetoWhenRelaxed: original.mirrorUpApplyDumpVetoWhenRelaxed,
              mirrorUpApplyChoppyVeto: choppyV,
              mirrorUpMinEmaSlopeBars: slopeBars,
              mirrorUpMinEmaSlopePct: slopePct,
              mirrorUpBelowEmaLookback: belowLb,
              mirrorUpMaxClosesBelowEma: belowLb === 0 ? original.mirrorUpMaxClosesBelowEma : maxBelow,
            });
          }
        }
      }
    }
  } else {
    for (const ema of [0.006, 0.01, 0.014, 0.018]) {
      for (const dump of [2.5, 3.5, 4.5, 6.5]) {
        for (const weak of [0.4, 0.5, 0.6, 0.68]) {
          for (const greenBtr of [0.33, 0.4, 0.48]) {
            for (const greenVsRed of [1.0, 1.15, 1.3]) {
              for (const reclaim of [0, 0.5, 0.8, 1.0]) {
                for (const dumpInRelaxed of [false, true]) {
                  upCases.push({
                    name: `ema${ema} dump${dump} weak${weak} gbtr${greenBtr} gvr${greenVsRed} reclaim${reclaim} dumpRelaxed${dumpInRelaxed ? "On" : "Off"}`,
                    mirrorUpMaxBelowEmaPct: ema,
                    mirrorUpDumpAtrMult: dump,
                    mirrorUpWeakRedBodyRangePct: weak,
                    mirrorUpMinGreenBodyToRange: greenBtr,
                    mirrorUpMinGreenBodyVsPrevRedMult: greenVsRed,
                    mirrorUpMinReclaimPrevRedBodyPct: reclaim,
                    mirrorUpApplyDumpVetoWhenRelaxed: dumpInRelaxed,
                    ...contextDefaults(),
                  });
                }
              }
            }
          }
        }
      }
    }
  }
  for (const c of upCases) {
    Object.assign(config, c);
    rows.push({ name: c.name, ...replayMirror(all, windowStartMs, windowEndMs) });
  }
} else {
  const downCases: DownCase[] = [];
  for (const btr of [0.33, 0.4, 0.48, 0.56]) {
    for (const maxRun of [6, 8, 9, 11]) {
      downCases.push({
        name: `btr${btr} maxRun${maxRun}`,
        mirrorDownMinBodyToRange: btr,
        mirrorDownMaxImpulseRun: maxRun,
      });
    }
  }
  for (const c of downCases) {
    Object.assign(config, c);
    rows.push({ name: c.name, ...replayMirror(all, windowStartMs, windowEndMs) });
  }
}

Object.assign(config, original);
rows.sort((a, b) => (b.winRatePct !== a.winRatePct ? b.winRatePct - a.winRatePct : b.total - a.total));

console.log(
  `Mirror strict ${side.toUpperCase()}${upContextMode ? " (context)" : ""} search over ${days} day(s)`,
);
console.log(
  JSON.stringify(
    {
      baseline: { name: "baseline", ...(() => {
        Object.assign(config, original);
        const r = replayMirror(all, windowStartMs, windowEndMs);
        return r;
      })() },
      top10: rows.slice(0, 10),
      topWithCount: rows.filter((r) => r.total >= (side === "up" ? 80 : 120)).slice(0, 10),
    },
    null,
    2,
  ),
);
