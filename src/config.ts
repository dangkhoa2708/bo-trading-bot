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

  exhaustionRunMin: number;
  exhaustionRevMinPrevRangeMult: number;
  exhaustionRevMaxPrevRangeMult: number;
  /** If false, Exhaustion skips near support/resistance veto (more signals). */
  exhaustionApplyLevelReconfirm: boolean;

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
  /** Mirror DOWN (Setup C fallback): only cap impulse run, not levels/window. */
  mirrorDownLightReconfirm: boolean;

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

  /** BSC JSON-RPC for PancakeSwap Prediction countdown (`/livecountdown`). */
  bscRpcUrl: string;

  /**
   * Optional: EOA private key for Pancake BNB prediction when you tap UP/DOWN on pre-prediction.
   * Set via `BSC_WALLET_PRIVATE_KEY` only — never commit. Empty = no on-chain bet.
   */
  bscWalletPrivateKey: string;
  /**
   * BNB amount per bet (wei). From `PANCAKE_PREDICTION_BET_BNB` (e.g. `0.01`). `0n` = disabled.
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

  exhaustionRunMin: 3,
  exhaustionRevMinPrevRangeMult: 0.2,
  exhaustionRevMaxPrevRangeMult: 0.62,
  /** Off = fewer exhaustion vetoes near S/R (more signals). */
  exhaustionApplyLevelReconfirm: false,

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

  // Mirror UP: allow bounce setups slightly further below EMA; less dump veto.
  mirrorMaxBelowEmaPct: 0.01,
  mirrorDumpAtrMult: 4.5,
  mirrorDumpLookback: 2,
  mirrorWeakRedBodyRangePct: 0.62,
  mirrorDownLightReconfirm: true,

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
  relaxedSignalFilters: false,

  bscRpcUrl: "https://bsc-dataseed.binance.org",

  bscWalletPrivateKey: "",
  pancakePredictionBetWei: 0n,
};

function loadPancakeBetWei(): bigint {
  const raw = process.env.PANCAKE_PREDICTION_BET_BNB?.trim();
  if (!raw) return 0n;
  try {
    return parseEther(raw as `${number}`);
  } catch {
    console.warn("[config] PANCAKE_PREDICTION_BET_BNB invalid — on-chain bets disabled");
    return 0n;
  }
}

export const config: BotConfig = {
  ...defaults,
  bscRpcUrl: process.env.BSC_RPC_URL ?? defaults.bscRpcUrl,
  bscWalletPrivateKey: process.env.BSC_WALLET_PRIVATE_KEY?.trim() ?? "",
  pancakePredictionBetWei: loadPancakeBetWei(),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};
