import { describe, expect, it } from "vitest";
import { normalizeBscPrivateKey } from "../src/pancakeswap/predictionBet.js";

describe("normalizeBscPrivateKey", () => {
  const valid =
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("accepts 0x + 64 hex", () => {
    expect(normalizeBscPrivateKey(valid)).toBe(valid);
  });

  it("accepts 64 hex without prefix", () => {
    expect(normalizeBscPrivateKey(valid.slice(2))).toBe(valid);
  });

  it("trims whitespace", () => {
    expect(normalizeBscPrivateKey(`  ${valid}  `)).toBe(valid);
  });

  it("rejects empty", () => {
    expect(normalizeBscPrivateKey("")).toBeNull();
    expect(normalizeBscPrivateKey("   ")).toBeNull();
  });

  it("rejects wrong length", () => {
    expect(normalizeBscPrivateKey("0xaa")).toBeNull();
  });
});
