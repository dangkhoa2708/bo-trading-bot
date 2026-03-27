import type { StrategyResult } from "../types.js";

export type DispatchDecision = { emit: boolean; reason?: string };

/** Avoid duplicate alerts for the same closed candle or same direction back-to-back. */
export class SignalDispatcher {
  private lastOpenTime: number | null = null;
  private lastDirection: "UP" | "DOWN" | null = null;

  shouldEmit(
    candleOpenTime: number,
    result: StrategyResult,
  ): DispatchDecision {
    if (result.signal === "NONE") {
      return { emit: false, reason: "no signal" };
    }
    if (this.lastOpenTime === candleOpenTime) {
      return { emit: false, reason: "already sent for this candle" };
    }
    if (this.lastDirection === result.signal) {
      return { emit: false, reason: "same direction as previous alert" };
    }
    this.lastOpenTime = candleOpenTime;
    this.lastDirection = result.signal;
    return { emit: true };
  }
}
