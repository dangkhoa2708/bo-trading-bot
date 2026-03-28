import { describe, expect, it } from "vitest";
import {
  consumeHumanPickForBar,
  getPlacementLinkForOpenTime,
  recordHumanPick,
  registerAwaitingHumanPick,
} from "../src/prediction/humanPick.js";

const link = (sig: string, pred: string) => ({ signalId: sig, predictionId: pred });

describe("humanPick", () => {
  it("records pick only while awaiting", () => {
    expect(recordHumanPick(1000, "UP")).toBe(false);
    registerAwaitingHumanPick(1000, link("sig-1000", "pred-1000"));
    expect(recordHumanPick(1000, "DOWN")).toBe(true);
    expect(recordHumanPick(1000, "UP")).toBe(true);
  });

  it("consume returns pick and clears awaiting", () => {
    registerAwaitingHumanPick(2000, link("sig-2000", "pred-2000"));
    recordHumanPick(2000, "UP");
    expect(consumeHumanPickForBar(2000)).toBe("UP");
    expect(consumeHumanPickForBar(2000)).toBeUndefined();
    expect(recordHumanPick(2000, "DOWN")).toBe(false);
  });

  it("exposes signal + prediction id until bar is consumed", () => {
    registerAwaitingHumanPick(3000, link("sig-abc", "pred-xyz"));
    expect(getPlacementLinkForOpenTime(3000)).toEqual({
      signalId: "sig-abc",
      predictionId: "pred-xyz",
    });
    consumeHumanPickForBar(3000);
    expect(getPlacementLinkForOpenTime(3000)).toBeUndefined();
  });

  it("preserves optional betWeiOverride for pick-button stake (e.g. /fakesignal)", () => {
    const wei = 1_500_000_000_000_000n;
    registerAwaitingHumanPick(4000, {
      signalId: "s",
      predictionId: "p",
      betWeiOverride: wei,
    });
    expect(getPlacementLinkForOpenTime(4000)?.betWeiOverride).toBe(wei);
  });
});
