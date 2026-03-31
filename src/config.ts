import "dotenv/config";
import { parseEther } from "viem";

export type BotConfig = {
  symbol: string;
  interval: string;
  candleBuffer: number;

  emaPeriod: number;
  bodyLookback: number;

  momentumBodyVsAvg: number;
  momentumRangeVsAvg: number;
  minBodyToRange: number;
  maxCloseToExtremePct: number;
  /**
   * When true, the first two of the last-3 same-color bars may be “doji” inners: small body/range,
   * only need min range vs baseline; signal bar (last) always full checks.
   */
  momentumAllowDojiInnerBars: boolean;
  /** Inner bar counts as doji if body/range ≤ this (signal bar never uses this path). */
  momentumDojiMaxBodyToRange: number;
  /** Doji inner bar: range must be ≥ this × baseline avg range. */
  momentumDojiMinRangeVsAvgMult: number;

  exhaustionRunMin: number;
  exhaustionRevMinPrevRangeMult: number;
  exhaustionRevMaxPrevRangeMult: number;
  /**
   * Reversal body must be ≥ this × avg body of pre-run baseline (was hard-coded 1.0).
   * Lower = allow smaller first counter bars after a grind (e.g. 0.55).
   */
  exhaustionRevBodyVsBaselineMult: number;
  /** Exhaustion reversal body/range must be ≥ this (separate from Momentum/Mirror wick tolerance). */
  exhaustionRevMinBodyToRange: number;
  /** Exhaustion reversal close must be within this fraction of candle range from its extreme. */
  exhaustionRevMaxCloseToExtremePct: number;
  /** If true, Exhaustion UP must close above EMA and DOWN below EMA. */
  exhaustionRequireEmaAlignment: boolean;
  /** If false, Exhaustion skips near support/resistance veto (more signals). */
  exhaustionApplyLevelReconfirm: boolean;
  /** DOWN-only override for min same-color run before reversal. */
  exhaustionDownRunMin: number;
  /** DOWN-only override for max reversal/previous range ratio. */
  exhaustionDownRevMaxPrevRangeMult: number;
  /** DOWN-only override for reversal body vs baseline multiplier. */
  exhaustionDownRevBodyVsBaselineMult: number;
  /** DOWN-only override for reversal body/range floor. */
  exhaustionDownRevMinBodyToRange: number;
  /** DOWN-only override for near-support veto. */
  exhaustionDownApplyLevelReconfirm: boolean;
  /** UP-only override for min same-color run before reversal. */
  exhaustionUpRunMin: number;
  /** UP-only override for max reversal/previous range ratio. */
  exhaustionUpRevMaxPrevRangeMult: number;
  /** UP-only override for reversal body vs baseline multiplier. */
  exhaustionUpRevBodyVsBaselineMult: number;
  /** UP-only override for reversal body/range floor. */
  exhaustionUpRevMinBodyToRange: number;
  /** UP-only: max distance from close to high (reversal green), stricter = smaller. */
  exhaustionUpRevMaxCloseToExtremePct: number;
  /** UP-only override for near-resistance veto. */
  exhaustionUpApplyLevelReconfirm: boolean;

  chopLookback: number;
  lowVolFactor: number;
  lowVolCompare: number;

  atrPeriod: number;
  minAtrPct: number;
  maxAtrPct: number;

  sidewaysEmaPct: number;

  mirrorMaxBelowEmaPct: number;
  mirrorDumpAtrMult: number;
  mirrorDumpLookback: number;
  /** Mirror UP: weak red body must be below this fraction of candle range (higher = looser). */
  mirrorWeakRedBodyRangePct: number;
  /** Mirror UP-only EMA distance cap. Smaller = stricter recovery requirement. */
  mirrorUpMaxBelowEmaPct: number;
  /** Mirror UP-only dump veto threshold (ATR multiple). Smaller = stricter. */
  mirrorUpDumpAtrMult: number;
  /** Mirror UP-only weak-red threshold. Smaller = stricter. */
  mirrorUpWeakRedBodyRangePct: number;
  /** Mirror UP-only green reversal body/range floor. */
  mirrorUpMinGreenBodyToRange: number;
  /** Mirror UP-only green body must be >= this × second red body. */
  mirrorUpMinGreenBodyVsPrevRedMult: number;
  /** Mirror UP-only: reclaim at least this fraction of the second red body by the green close. */
  mirrorUpMinReclaimPrevRedBodyPct: number;
  /** Mirror UP-only: optionally apply dump veto even when relaxed filters are on. */
  mirrorUpApplyDumpVetoWhenRelaxed: boolean;
  /**
   * Mirror UP-only: when true, reject Mirror UP if `choppy()` (alternating bars) even when
   * `relaxedSignalFilters` disables the global chop skip.
   */
  mirrorUpApplyChoppyVeto: boolean;
  /**
   * Mirror UP-only: require EMA20 slope over this many bars to be ≥ `mirrorUpMinEmaSlopePct`
   * (relative change `(ema_now − ema_past) / ema_past`). `0` = disabled.
   */
  mirrorUpMinEmaSlopeBars: number;
  /** Minimum allowed EMA20 relative slope over `mirrorUpMinEmaSlopeBars` (see above). */
  mirrorUpMinEmaSlopePct: number;
  /**
   * Mirror UP-only: count closes strictly below EMA20 on each bar in this lookback (excluding the
   * last 3 bars). `0` = skip this filter.
   */
  mirrorUpBelowEmaLookback: number;
  /** If `mirrorUpBelowEmaLookback` > 0, veto when closes-below-EMA count exceeds this. */
  mirrorUpMaxClosesBelowEma: number;
  /** Mirror DOWN (Setup C fallback): only cap impulse run, not levels/window. */
  mirrorDownLightReconfirm: boolean;
  /** Mirror DOWN-only red signal bar body/range floor. */
  mirrorDownMinBodyToRange: number;
  /** Mirror DOWN-only max impulse run. */
  mirrorDownMaxImpulseRun: number;

  /** Opposite-color body ≤ this × ATR counts as micro pause (does not reset run). */
  momentumMicroPauseBodyAtrMult: number;
  /** Micro pause must also be ≤ this × median body (avoids treating normal counter bars as pauses). */
  momentumMicroPauseBodyVsMedianMult: number;
  /** Block Momentum if same-direction run length (micro pauses ignored) exceeds this. */
  momentumMaxImpulseRun: number;

  /** Lookbacks (excluding last candle) for prior swing low / high. */
  levelLookbackShort: number;
  levelLookbackLong: number;
  /** Near support/resistance if distance to level ≤ this × ATR. */
  levelNearAtrMult: number;
  /** Also use max(ATR, close × this) for level distance (case 2/5). */
  levelNearPricePct: number;

  /** In last N bars, if same-direction bars ≥ max, skip Momentum (case 4). */
  momentumSameDirWindow: number;
  momentumMaxSameDirBarsInWindow: number;

  /** Mirror: veto if green body exceeds ATR × this (spike). */
  mirrorMaxGreenBodyAtrMult: number;
  /** Mirror: veto if green body exceeds median body × this. */
  mirrorMaxGreenBodyVsMedianMult: number;
  mirrorMedianBodyLookback: number;

  dryRun: boolean;

  /**
   * When true: skip/soften market-regime gates and spike vetoes so more setups pass — intended
   * for manual review via Telegram buttons. Toggle in `defaults` below. More false positives.
   */
  relaxedSignalFilters: boolean;

  /**
   * When false, Mirror uses SignalDispatcher same-direction dedupe (no back-to-back Mirror UP/DOWN).
   * When true, consecutive Mirror alerts may repeat direction — useful for manual review; noisier.
   */
  mirrorAllowRepeatSameDirection: boolean;

  /** BSC JSON-RPC for PancakeSwap Prediction countdown (`/livecountdown`). */
  bscRpcUrl: string;

  /**
   * Optional: EOA private key for Pancake BNB prediction when you tap UP/DOWN on pre-prediction.
   * Set via `BSC_WALLET_PRIVATE_KEY` only — never commit. Empty = no on-chain bet.
   */
  bscWalletPrivateKey: string;
  /**
   * BNB amount per bet (wei). Set in `defaults` below. `0n` = disabled.
   */
  pancakePredictionBetWei: bigint;

  telegramBotToken: string;
  telegramChatId: string;
};

// Strategy/runtime settings live here (code-level config).
// Secrets live in `.env` only (Telegram token/chat id).
//
// Default preset is **relaxed** vs the original: higher ATR ceiling (volatile 5m BNB),
// slightly easier momentum bodies/ranges, looser chop/sideways/low-vol, softer Mirror guards,
// and fewer level / extended-leg vetoes — more signals, more false positives.
const defaults: Omit<BotConfig, "telegramBotToken" | "telegramChatId"> = {
  symbol: "BNBUSDT",
  interval: "5m",
  candleBuffer: 50,

  emaPeriod: 20,
  bodyLookback: 20,

  // Momentum: 3 same-color bars vs baseline — looser body/range and wick tolerance.
  momentumBodyVsAvg: 0.56,
  momentumRangeVsAvg: 0.56,
  minBodyToRange: 0.33,
  maxCloseToExtremePct: 0.48,

  momentumAllowDojiInnerBars: true,
  momentumDojiMaxBodyToRange: 0.22,
  momentumDojiMinRangeVsAvgMult: 0.26,

  /** Shared Exhaustion baseline; DOWN can be made stricter via the overrides below. */
  exhaustionRunMin: 3,
  exhaustionRevMinPrevRangeMult: 0.2,
  /** Keep looser global cap; DOWN can use a tighter cap through its override. */
  exhaustionRevMaxPrevRangeMult: 2.0,
  /** Keep looser UP baseline; stricter DOWN body is applied via override. */
  exhaustionRevBodyVsBaselineMult: 0.55,
  /** Default matches prior global wick tolerance used by Exhaustion. */
  exhaustionRevMinBodyToRange: 0.33,
  /** Default matches prior global close-to-extreme tolerance used by Exhaustion. */
  exhaustionRevMaxCloseToExtremePct: 0.48,
  /** Off by default; can improve win rate at the cost of fewer signals. */
  exhaustionRequireEmaAlignment: false,
  /** Off = fewer exhaustion vetoes near S/R (more signals). */
  exhaustionApplyLevelReconfirm: false,
  /** DOWN is noisier; 90d search preferred longer runs and a stronger body/range floor. */
  exhaustionDownRunMin: 5,
  exhaustionDownRevMaxPrevRangeMult: 2.0,
  exhaustionDownRevBodyVsBaselineMult: 0.55,
  exhaustionDownRevMinBodyToRange: 0.43,
  exhaustionDownApplyLevelReconfirm: false,
  /**
   * UP: 90d search — best trade-off vs baseline was run 4, body 0.75, maxPrev 2, level off.
   */
  exhaustionUpRunMin: 4,
  exhaustionUpRevMaxPrevRangeMult: 2.0,
  exhaustionUpRevBodyVsBaselineMult: 0.75,
  exhaustionUpRevMinBodyToRange: 0.33,
  exhaustionUpRevMaxCloseToExtremePct: 0.48,
  exhaustionUpApplyLevelReconfirm: false,

  /** Longer alternating window required → fewer “choppy” skips. */
  chopLookback: 4,
  /** Lower = harder to qualify as “low vol” skip. */
  lowVolFactor: 0.3,
  lowVolCompare: 20,

  atrPeriod: 14,
  minAtrPct: 0.00005,
  /** Was 3%; sharp 5m moves often exceed that and produced no signals. */
  maxAtrPct: 0.055,

  // Narrower “sideways” band vs EMA → fewer sideways skips.
  sidewaysEmaPct: 0.0007,

  // Mirror UP: looser V-bounce (large flush no longer vetoes R,R,G as often).
  mirrorMaxBelowEmaPct: 0.018,
  mirrorDumpAtrMult: 6.5,
  mirrorDumpLookback: 2,
  mirrorWeakRedBodyRangePct: 0.68,
  mirrorUpMaxBelowEmaPct: 0.018,
  mirrorUpDumpAtrMult: 6.5,
  mirrorUpWeakRedBodyRangePct: 0.68,
  mirrorUpMinGreenBodyToRange: 0.33,
  mirrorUpMinGreenBodyVsPrevRedMult: 1.0,
  mirrorUpMinReclaimPrevRedBodyPct: 0,
  mirrorUpApplyDumpVetoWhenRelaxed: false,
  mirrorUpApplyChoppyVeto: false,
  /** 90d strict Mirror context search: floor EMA slope to avoid steep bearish EMA. */
  mirrorUpMinEmaSlopeBars: 6,
  mirrorUpMinEmaSlopePct: -0.003,
  /** 90d strict search: veto UP when >5 of prior 10 bars (excl. last 3) closed below EMA20. */
  mirrorUpBelowEmaLookback: 10,
  mirrorUpMaxClosesBelowEma: 5,
  mirrorDownLightReconfirm: true,
  /** Mirror DOWN: 90d strict search favored a much stronger red signal bar. */
  mirrorDownMinBodyToRange: 0.56,
  mirrorDownMaxImpulseRun: 6,

  momentumMicroPauseBodyAtrMult: 0.35,
  momentumMicroPauseBodyVsMedianMult: 0.42,
  momentumMaxImpulseRun: 9,

  levelLookbackShort: 10,
  levelLookbackLong: 50,
  /** Smaller buffer → fewer “near support/resistance” blocks. */
  levelNearAtrMult: 0.24,
  levelNearPricePct: 0.00042,

  momentumSameDirWindow: 16,
  momentumMaxSameDirBarsInWindow: 11,

  mirrorMaxGreenBodyAtrMult: 4.2,
  mirrorMaxGreenBodyVsMedianMult: 7.0,
  mirrorMedianBodyLookback: 20,

  dryRun: false,

  /** Set `true` here for looser signals (manual review); see JSDoc on `BotConfig.relaxedSignalFilters`. */
  relaxedSignalFilters: true,

  /** Strict Mirror dedupe: do not emit same direction back-to-back. */
  mirrorAllowRepeatSameDirection: false,

  bscRpcUrl: "https://bsc-dataseed.binance.org",

  bscWalletPrivateKey: "",
  pancakePredictionBetWei: parseEther("0.005"),
};

export const config: BotConfig = {
  ...defaults,
  bscRpcUrl: process.env.BSC_RPC_URL ?? defaults.bscRpcUrl,
  bscWalletPrivateKey: process.env.BSC_WALLET_PRIVATE_KEY?.trim() ?? "",
  pancakePredictionBetWei: defaults.pancakePredictionBetWei,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};
