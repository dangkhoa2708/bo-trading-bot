import { describe, expect, it, vi } from "vitest";

/**
 * Relax regime gates so this file only regression-tests doji inners (matches common live preset).
 * `momentumAllowDojiInnerBars` / doji thresholds stay production defaults from `config.ts`.
 */
vi.mock("../src/config.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...mod,
    config: { ...mod.config, relaxedSignalFilters: true },
  };
});

import { evaluate, momentumWindow } from "../src/strategy/engine.js";
import type { Candle } from "../src/types.js";

function candleOhlc(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return { openTime, open, high, low, close, volume: 100 };
}

function candle(
  openTime: number,
  open: number,
  close: number,
  wick = 0.2,
): Candle {
  const high = Math.max(open, close) + wick;
  const low = Math.min(open, close) - wick;
  return { openTime, open, high, low, close, volume: 100 };
}

function upTrendBase(count: number, start = 100): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    const o = p;
    const c = p + 0.3;
    out.push(candle(i * 300_000, o, c, 0.25));
    p = c;
  }
  return out;
}

describe("momentum doji inner bars (production defaults)", () => {
  it("allows Momentum UP when first two of last 3 are doji greens and signal bar is strong", () => {
    // Same spine as `returns Momentum UP for 3 strong green closes above EMA` but inners are doji.
    const base = upTrendBase(21, 100);
    const lastRed = candle(21 * 300_000, 106.3, 106.0, 0.12);
    const last3 = [
      candleOhlc(22 * 300_000, 106.0, 107.8, 105.9, 106.06),
      candleOhlc(23 * 300_000, 106.06, 108.0, 105.95, 106.09),
      candle(24 * 300_000, 109.6, 111.5, 0.15),
    ];
    const series = [...base, lastRed, ...last3];
    const mw = momentumWindow(series);
    expect(mw.ok, mw.note).toBe(true);
    const r = evaluate(series);
    expect(r.signal, r.reason).toBe("UP");
    expect(r.setup).toBe("Momentum");
    expect(r.reason).toContain("3 strong greens");
  });
});
