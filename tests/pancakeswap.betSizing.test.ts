import { describe, expect, it } from "vitest";
import { effectivePancakeBetWei } from "../src/pancakeswap/betSizing.js";

describe("effectivePancakeBetWei", () => {
  it("uses full size for UP bets", () => {
    expect(effectivePancakeBetWei(10n, "UP")).toBe(10n);
    expect(effectivePancakeBetWei(11n, "UP")).toBe(11n);
  });

  it("uses full size for DOWN bets", () => {
    expect(effectivePancakeBetWei(10n, "DOWN")).toBe(10n);
  });
});
