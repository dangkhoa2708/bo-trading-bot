import { config } from "../config.js";
import type { StrategyResult } from "../types.js";

export type DispatchDecision = { emit: boolean; reason?: string };

/** Momentum / Exhaustion: emit every engine fire (still one alert per candle). Mirror: dedupe unless disabled in config. */
export function usesStrictDirectionDedupe(setup: string): boolean {
  if (setup === "Momentum" || setup === "Exhaustion") return false;
  if (setup === "Mirror" && config.mirrorAllowRepeatSameDirection) return false;
  return true;
}

/**
 * Avoid duplicate alerts for the same closed candle. Optionally block same
 * direction back-to-back (strict path for Mirror — aligns with better emitted-only win rate).
 */
export class SignalDispatcher {
  private lastOpenTime: number | null = null;
  private lastDirectionBySetup = new Map<string, "UP" | "DOWN">();

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
      this.lastDirectionBySetup.get(result.setup) === result.signal
    ) {
      return { emit: false, reason: "same direction as previous alert" };
    }
    this.lastOpenTime = candleOpenTime;
    this.lastDirectionBySetup.set(result.setup, result.signal);
    return { emit: true };
  }
}
