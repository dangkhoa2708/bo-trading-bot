import { describe, expect, it } from "vitest";
import {
  consumeHumanPickForBar,
  recordHumanPick,
  registerAwaitingHumanPick,
} from "../src/prediction/humanPick.js";

describe("humanPick", () => {
  it("records pick only while awaiting", () => {
    expect(recordHumanPick(1000, "UP")).toBe(false);
    registerAwaitingHumanPick(1000);
    expect(recordHumanPick(1000, "DOWN")).toBe(true);
    expect(recordHumanPick(1000, "UP")).toBe(true);
  });

  it("consume returns pick and clears awaiting", () => {
    registerAwaitingHumanPick(2000);
    recordHumanPick(2000, "UP");
    expect(consumeHumanPickForBar(2000)).toBe("UP");
    expect(consumeHumanPickForBar(2000)).toBeUndefined();
    expect(recordHumanPick(2000, "DOWN")).toBe(false);
  });
});
