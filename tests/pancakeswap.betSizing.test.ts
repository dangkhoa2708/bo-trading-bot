import { describe, expect, it } from "vitest";
import { effectivePancakeBetWei } from "../src/pancakeswap/betSizing.js";

describe("effectivePancakeBetWei", () => {
  it("uses half size for UP bets", () => {
    expect(effectivePancakeBetWei(10n, "UP")).toBe(5n);
    expect(effectivePancakeBetWei(11n, "UP")).toBe(5n);
  });

  it("uses full size for DOWN bets", () => {
    expect(effectivePancakeBetWei(10n, "DOWN")).toBe(10n);
  });
});
