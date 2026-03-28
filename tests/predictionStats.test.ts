import { describe, expect, it } from "vitest";
import {
  buildDualPredictionStats,
  scoreRowVsBot,
  scoreRowVsMyPick,
} from "../src/report/predictionStats.js";

describe("buildDualPredictionStats", () => {
  it("scores bot on all rows and my picks only when humanPick set", () => {
    const rows = [
      {
        fromOpenTime: 1,
        expected: "UP",
        botExpected: "UP" as const,
        humanPick: "DOWN" as const,
        actual: "UP",
        setup: "Momentum",
      },
      {
        fromOpenTime: 2,
        expected: "DOWN",
        botExpected: "DOWN" as const,
        humanPick: null,
        actual: "UP",
        setup: "Mirror",
      },
    ];
    const d = buildDualPredictionStats(rows, (p) => p.setup ?? "Other");
    expect(d.bot.total).toBe(2);
    expect(d.bot.right).toBe(1);
    expect(d.bot.wrong).toBe(1);
    expect(d.myPicks.total).toBe(1);
    expect(d.myPicks.right).toBe(0);
    expect(d.myPicks.wrong).toBe(1);
  });

  it("excludes IGNORED and PLACEMENT rows from candle stats", () => {
    const rows = [
      {
        fromOpenTime: 1,
        expected: "UP",
        botExpected: "UP" as const,
        humanPick: null,
        actual: "DOWN",
        setup: "Momentum",
        result: "IGNORED",
      },
      {
        fromOpenTime: 2,
        expected: "UP",
        botExpected: "UP" as const,
        humanPick: "UP" as const,
        actual: "DOWN",
        setup: "Mirror",
        result: "PLACEMENT",
      },
      {
        fromOpenTime: 3,
        expected: "UP",
        botExpected: "UP" as const,
        humanPick: null,
        actual: "UP",
        setup: "Mirror",
        result: "RIGHT",
      },
    ];
    const d = buildDualPredictionStats(rows, (p) => p.setup ?? "Other");
    expect(d.bot.total).toBe(1);
    expect(d.bot.right).toBe(1);
    expect(d.myPicks.total).toBe(0);
  });
});

describe("scoreRowVsBot", () => {
  it("returns null for IGNORED / PLACEMENT", () => {
    expect(
      scoreRowVsBot({
        fromOpenTime: 0,
        expected: "UP",
        botExpected: "UP",
        actual: "UP",
        result: "IGNORED",
      }),
    ).toBeNull();
    expect(
      scoreRowVsBot({
        fromOpenTime: 0,
        expected: "UP",
        botExpected: "UP",
        actual: "DOWN",
        result: "PLACEMENT",
      }),
    ).toBeNull();
  });

  it("uses botExpected or legacy expected", () => {
    expect(
      scoreRowVsBot({
        fromOpenTime: 0,
        expected: "UP",
        actual: "UP",
      }),
    ).toBe("RIGHT");
    expect(
      scoreRowVsBot({
        fromOpenTime: 0,
        expected: "UP",
        botExpected: "DOWN",
        actual: "UP",
      }),
    ).toBe("WRONG");
  });
});

describe("scoreRowVsMyPick", () => {
  it("returns null for IGNORED / PLACEMENT", () => {
    expect(
      scoreRowVsMyPick({
        fromOpenTime: 0,
        expected: "UP",
        humanPick: "UP",
        actual: "UP",
        result: "PLACEMENT",
      }),
    ).toBeNull();
  });

  it("returns null without human pick", () => {
    expect(
      scoreRowVsMyPick({
        fromOpenTime: 0,
        expected: "UP",
        humanPick: null,
        actual: "UP",
      }),
    ).toBeNull();
  });
});
