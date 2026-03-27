import { describe, expect, it } from "vitest";
import {
  SignalDispatcher,
  usesStrictDirectionDedupe,
} from "../src/signal/dispatcher.js";
import type { StrategyResult } from "../src/types.js";

const upMom: StrategyResult = {
  signal: "UP",
  setup: "Momentum",
  reason: "test",
};
const upEx: StrategyResult = {
  signal: "UP",
  setup: "Exhaustion",
  reason: "test",
};
const upMir: StrategyResult = {
  signal: "UP",
  setup: "Mirror",
  reason: "test",
};
const down: StrategyResult = {
  signal: "DOWN",
  setup: "Momentum",
  reason: "test",
};
const downMir: StrategyResult = {
  signal: "DOWN",
  setup: "Mirror",
  reason: "test",
};
const none: StrategyResult = { signal: "NONE", setup: "None", reason: "none" };

describe("usesStrictDirectionDedupe", () => {
  it("is strict only for Mirror (and non Momentum/Exhaustion)", () => {
    expect(usesStrictDirectionDedupe("Mirror")).toBe(true);
    expect(usesStrictDirectionDedupe("None")).toBe(true);
    expect(usesStrictDirectionDedupe("Momentum")).toBe(false);
    expect(usesStrictDirectionDedupe("Exhaustion")).toBe(false);
  });
});

describe("SignalDispatcher", () => {
  it("does not emit NONE signals", () => {
    const d = new SignalDispatcher();
    const r = d.shouldEmit(1, none);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("no signal");
  });

  it("blocks duplicate candle open time", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMom).emit).toBe(true);
    const r = d.shouldEmit(100, down);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("already sent for this candle");
  });

  it("allows Momentum same direction back-to-back", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMom).emit).toBe(true);
    expect(d.shouldEmit(200, upMom).emit).toBe(true);
  });

  it("allows Exhaustion same direction back-to-back", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upEx).emit).toBe(true);
    expect(d.shouldEmit(200, upEx).emit).toBe(true);
  });

  it("blocks Mirror same direction back-to-back", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMir).emit).toBe(true);
    const r = d.shouldEmit(200, upMir);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("same direction as previous alert");
  });

  it("blocks Mirror when previous emit was same-dir Momentum", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMom).emit).toBe(true);
    const r = d.shouldEmit(200, upMir);
    expect(r.emit).toBe(false);
    expect(r.reason).toBe("same direction as previous alert");
  });

  it("allows Momentum after same-dir Mirror (loose bypass)", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMir).emit).toBe(true);
    expect(d.shouldEmit(200, upMom).emit).toBe(true);
  });

  it("allows opposite direction on next candle", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMom).emit).toBe(true);
    expect(d.shouldEmit(200, down).emit).toBe(true);
  });

  it("allows Mirror opposite direction after Mirror", () => {
    const d = new SignalDispatcher();
    expect(d.shouldEmit(100, upMir).emit).toBe(true);
    expect(d.shouldEmit(200, downMir).emit).toBe(true);
  });
});
