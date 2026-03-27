import { describe, expect, it } from "vitest";
import { evaluate } from "../src/strategy/engine.js";
import type { Candle } from "../src/types.js";

function candleOhlc(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
): Candle {
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

function candle(
  openTime: number,
  open: number,
  close: number,
  wick = 0.2,
): Candle {
  const high = Math.max(open, close) + wick;
  const low = Math.min(open, close) - wick;
  return {
    openTime,
    open,
    high,
    low,
    close,
    volume: 100,
  };
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

function downTrendBase(count: number, start = 120): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    const o = p;
    const c = p - 0.3;
    out.push(candle(i * 300_000, o, c, 0.25));
    p = c;
  }
  return out;
}

describe("strategy evaluate", () => {
  it("returns NONE while warming up", () => {
    const candles = upTrendBase(10);
    const r = evaluate(candles);
    expect(r.signal).toBe("NONE");
    expect(r.reason).toContain("warming up");
  });

  it("blocks Momentum UP when same-color run exceeds max impulse length", () => {
    const base = upTrendBase(18, 100);
    const lastRed = candle(18 * 300_000, 105.4, 105.1, 0.12);
    const eightGreens = [
      candle(19 * 300_000, 105.1, 106.2, 0.15),
      candle(20 * 300_000, 106.2, 107.4, 0.15),
      candle(21 * 300_000, 107.4, 108.6, 0.15),
      candle(22 * 300_000, 108.6, 109.8, 0.15),
      candle(23 * 300_000, 109.8, 111.0, 0.15),
      candle(24 * 300_000, 111.0, 112.2, 0.15),
      candle(25 * 300_000, 112.2, 113.4, 0.15),
      candle(26 * 300_000, 113.4, 114.6, 0.15),
    ];
    const r = evaluate([...base, lastRed, ...eightGreens]);
    expect(r.signal).toBe("NONE");
    expect(r.reason).toContain("reconfirm");
  });

  it("returns Momentum UP for 3 strong green closes above EMA", () => {
    // Break long same-color run so reconfirmation (max impulse length) allows Momentum.
    // Need ≥25 candles (engine warmup); 21 + 1 red + 3 greens = 25.
    const base = upTrendBase(21, 100);
    const lastRed = candle(21 * 300_000, 106.3, 106.0, 0.12);
    const last3 = [
      candle(22 * 300_000, 106.0, 107.8, 0.15),
      candle(23 * 300_000, 107.8, 109.6, 0.15),
      candle(24 * 300_000, 109.6, 111.5, 0.15),
    ];
    const r = evaluate([...base, lastRed, ...last3]);
    expect(r.signal).toBe("UP");
    expect(r.setup).toBe("Momentum");
  });

  it("returns Mirror UP for weak reds then strong green", () => {
    const base = upTrendBase(22, 100);
    const pattern = [
      candle(22 * 300_000, 108.0, 107.0, 0.25),
      candle(23 * 300_000, 107.0, 106.6, 0.25),
      candle(24 * 300_000, 106.6, 108.1, 0.1),
    ];
    const r = evaluate([...base, ...pattern]);
    expect(r.signal).toBe("UP");
    expect(r.setup).toBe("Mirror");
  });

  it("rejects Mirror UP after dump while still below EMA", () => {
    const base = downTrendBase(26, 120);
    const dump = candleOhlc(26 * 300_000, 112.0, 112.2, 102.0, 103.0);
    const pattern = [
      dump,
      candle(27 * 300_000, 103.0, 102.6, 0.15), // weak red
      candle(28 * 300_000, 102.6, 102.5, 0.15), // weaker red
      candle(29 * 300_000, 102.5, 103.2, 0.05), // green bounce
    ];
    const r = evaluate([...base, ...pattern]);
    expect(r.signal).toBe("NONE");
  });

  it("returns Exhaustion DOWN after 5 green then strong red", () => {
    const base = upTrendBase(20, 100);
    const runAndReversal = [
      candle(20 * 300_000, 104.0, 105.0, 0.2),
      candle(21 * 300_000, 105.0, 105.8, 0.2),
      candle(22 * 300_000, 105.8, 106.4, 0.2),
      candle(23 * 300_000, 106.4, 106.9, 0.2),
      candle(24 * 300_000, 106.9, 107.3, 0.3), // prev range ~1.0
      // OHLC reversal so range vs prev + body vs baseline stay inside exhaustion rules
      candleOhlc(25 * 300_000, 107.3, 107.35, 106.86, 106.9),
    ];
    const r = evaluate([...base, ...runAndReversal]);
    expect(r.signal).toBe("DOWN");
    expect(r.setup).toBe("Exhaustion");
  });

  it("returns NONE for choppy alternating candles", () => {
    const base = upTrendBase(22, 100);
    const choppyTail = [
      candle(22 * 300_000, 106.0, 106.8),
      candle(23 * 300_000, 106.8, 106.1),
      candle(24 * 300_000, 106.1, 106.9),
      candle(25 * 300_000, 106.9, 106.2),
    ];
    const r = evaluate([...base, ...choppyTail]);
    expect(r.signal).toBe("NONE");
    expect(r.reason).toContain("choppy");
  });

  it("rejects momentum when close is not near candle extreme", () => {
    const base = upTrendBase(22, 100);
    const last3 = [
      candle(22 * 300_000, 106.6, 108.2, 0.15),
      candle(23 * 300_000, 108.2, 109.8, 0.15),
      // strong green but upper wick large enough that closeNearExtreme fails at current maxCloseToExtremePct
      candleOhlc(24 * 300_000, 109.8, 112.4, 109.7, 110.5),
    ];
    const r = evaluate([...base, ...last3]);
    expect(r.signal).toBe("NONE");
  });

  it("rejects momentum when candle range does not expand enough", () => {
    const base = upTrendBase(22, 100);
    const last3 = [
      candle(22 * 300_000, 106.6, 106.7, 0.02),
      candle(23 * 300_000, 106.7, 106.8, 0.02),
      candle(24 * 300_000, 106.8, 106.9, 0.02),
    ];
    const r = evaluate([...base, ...last3]);
    expect(r.signal).toBe("NONE");
  });

  it("returns NONE when ATR is too low", () => {
    const candles: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 30; i++) {
      const o = p;
      const c = p + 0.001;
      candles.push(candle(i * 300_000, o, c, 0.0005));
      p = c;
    }
    const r = evaluate(candles);
    expect(r.signal).toBe("NONE");
    expect(r.reason).toContain("atr out of band");
  });

  it("returns NONE when ATR is too high", () => {
    const candles: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 30; i++) {
      const o = p;
      const c = p + 4;
      candles.push(candle(i * 300_000, o, c, 2));
      p = c;
    }
    const r = evaluate(candles);
    expect(r.signal).toBe("NONE");
    expect(r.reason).toContain("atr out of band");
  });

  it("rejects exhaustion when reversal candle is bigger than previous candle", () => {
    const base = upTrendBase(20, 100);
    const pattern = [
      candle(20 * 300_000, 106.0, 105.4, 0.12),
      candle(21 * 300_000, 105.4, 104.9, 0.12),
      candle(22 * 300_000, 104.9, 104.5, 0.12),
      candle(23 * 300_000, 104.5, 104.2, 0.12),
      // huge reversal vs prev (exhaustion off) — close not at extreme so Mirror UP does not fire
      candleOhlc(24 * 300_000, 104.2, 106.6, 104.0, 105.0),
    ];
    const r = evaluate([...base, ...pattern]);
    expect(r.signal).toBe("NONE");
  });

  it("rejects exhaustion when reversal candle is too small vs previous", () => {
    const base = upTrendBase(20, 100);
    const pattern = [
      candle(20 * 300_000, 106.0, 105.4, 0.12),
      candle(21 * 300_000, 105.4, 104.9, 0.12),
      candle(22 * 300_000, 104.9, 104.5, 0.12),
      candle(23 * 300_000, 104.5, 104.2, 0.12), // prev range ~0.54
      // rev range / prev range below exhaustion min — close not at extreme so Mirror UP does not fire
      candleOhlc(24 * 300_000, 104.18, 104.26, 104.15, 104.19),
    ];
    const r = evaluate([...base, ...pattern]);
    expect(r.signal).toBe("NONE");
  });
});
