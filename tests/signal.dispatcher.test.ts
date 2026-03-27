import { describe, expect, it } from "vitest";
import { SignalDispatcher } from "../src/signal/dispatcher.js";
import type { StrategyResult } from "../src/types.js";

const up: StrategyResult = { signal: "UP", setup: "Momentum", reason: "test" };
const down: StrategyResult = {
  signal: "DOWN",
  setup: "Momentum",
  reason: "test",
};
const none: StrategyResult = { signal: "NONE", setup: "None", reason: "none" };

describe("SignalDispatcher", () => {
  it("does not emit NONE signals", () => {
    const d = new SignalDispatcher();
    const r = d.shouldEmit(1, none);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("no signal");
  });

  it("blocks duplicate candle open time", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, up).emit).toBe(true);
    const r = d.shouldEmit(100, down);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("already sent for this candle");
  });

  it("blocks same direction back-to-back", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, up).emit).toBe(true);
    const r = d.shouldEmit(200, up);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("same direction as previous alert");
  });

  it("allows opposite direction on next candle", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, up).emit).toBe(true);
    expect(d.shouldEmit(200, down).emit).toBe(true);
  });
});
