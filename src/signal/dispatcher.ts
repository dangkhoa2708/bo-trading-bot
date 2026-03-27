import type { StrategyResult } from "../types.js";

export type DispatchDecision = { emit: boolean; reason?: string };

/** Momentum / Exhaustion: emit every engine fire (still one alert per candle). Mirror: full dedupe (same-dir skip). */
export function usesStrictDirectionDedupe(setup: string): boolean {
  return setup !== "Momentum" && setup !== "Exhaustion";
}

/**
 * Avoid duplicate alerts for the same closed candle. Optionally block same
 * direction back-to-back (strict path for Mirror — aligns with better emitted-only win rate).
 */
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
    if (
      usesStrictDirectionDedupe(result.setup) &&
      this.lastDirection === result.signal
    ) {
      return { emit: false, reason: "same direction as previous alert" };
    }
    this.lastOpenTime = candleOpenTime;
    this.lastDirection = result.signal;
    return { emit: true };
  }
}
