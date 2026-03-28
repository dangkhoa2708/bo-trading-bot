import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FAKE_SIGNAL_SETUP } from "../src/prediction/injectedFakeSignal.js";
import {
  filterPancakeAggregateExcludingFakeSignals,
  isFakeSignalPancakePlacement,
  isFakeSignalPredictionRow,
  isFakeSignalSetup,
} from "../src/report/reportFilters.js";
import { aggregatePancakePlacements } from "../src/report/pancakePlacementReport.js";
import type { PancakePlacementRecord } from "../src/pancakeswap/placementLedger.js";

function pl(
  signalId: string,
  betWei: string,
  profitWei: string,
): PancakePlacementRecord {
  return {
    placementId: randomUUID(),
    signalId,
    epoch: "1",
    direction: "UP",
    betWei,
    claimWei: "0",
    profitWei,
    betAmountBnb: "0",
    claimAmountBnb: "0",
    profitBnb: "0",
    outcome: "lost",
    betTxHash: "0x",
    settledAt: new Date().toISOString(),
    bnbUsdAtSettle: null,
    stakeUsdtApprox: null,
    claimUsdtApprox: null,
    profitUsdtApprox: null,
  };
}

describe("reportFilters", () => {
  it("detects fake signal setup", () => {
    expect(isFakeSignalSetup(FAKE_SIGNAL_SETUP)).toBe(true);
    expect(isFakeSignalSetup("Mirror")).toBe(false);
  });

  it("detects fake prediction rows by setup or signalId suffix", () => {
    expect(
      isFakeSignalPredictionRow({
        setup: FAKE_SIGNAL_SETUP,
        signalId: "x",
      }),
    ).toBe(true);
    expect(
      isFakeSignalPredictionRow({
        setup: "Mirror",
        signalId: `173-UP-${FAKE_SIGNAL_SETUP}`,
      }),
    ).toBe(true);
    expect(
      isFakeSignalPredictionRow({
        setup: "Mirror",
        signalId: "173-UP-Mirror",
      }),
    ).toBe(false);
  });

  it("detects fake-linked Pancake rows by signalId", () => {
    expect(isFakeSignalPancakePlacement(`123-DOWN-${FAKE_SIGNAL_SETUP}`)).toBe(
      true,
    );
    expect(isFakeSignalPancakePlacement("MANUAL_PLACEMENT")).toBe(false);
    expect(isFakeSignalPancakePlacement(undefined)).toBe(false);
  });

  it("filters Pancake aggregate", () => {
    const rows = [
      pl(`1-UP-${FAKE_SIGNAL_SETUP}`, "1", "-1"),
      pl("173-UP-Mirror", "2", "-2"),
    ];
    const agg = aggregatePancakePlacements(rows);
    const filtered = filterPancakeAggregateExcludingFakeSignals(agg);
    expect(filtered.count).toBe(1);
    expect(filtered.rows[0]!.signalId).toBe("173-UP-Mirror");
  });
});
