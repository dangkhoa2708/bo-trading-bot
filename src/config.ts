import "dotenv/config";

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

  telegramBotToken: string;
  telegramChatId: string;
};

// Strategy/runtime settings live here (code-level config).
// Secrets live in `.env` only (Telegram token/chat id).
const defaults: Omit<BotConfig, "telegramBotToken" | "telegramChatId"> = {
  symbol: "BNBUSDT",
  interval: "5m",
  candleBuffer: 50,

  emaPeriod: 20,
  bodyLookback: 20,

  // Momentum: slightly looser for more setups (still 3 strong candles + EMA side).
  momentumBodyVsAvg: 0.65,
  momentumRangeVsAvg: 0.65,
  minBodyToRange: 0.38,
  maxCloseToExtremePct: 0.42,

  exhaustionRunMin: 4,
  exhaustionRevMinPrevRangeMult: 0.3,
  exhaustionRevMaxPrevRangeMult: 0.5,

  chopLookback: 3,
  lowVolFactor: 0.38,
  lowVolCompare: 20,

  atrPeriod: 14,
  minAtrPct: 0.00005,
  maxAtrPct: 0.03,

  // Wider band vs EMA = fewer false “sideways” skips on slow grinds.
  sidewaysEmaPct: 0.00085,

  // Mirror (Setup C) guards: avoid fake bounces in strong downtrend / post-dump.
  mirrorMaxBelowEmaPct: 0.002, // allow Mirror UP if close is within 0.2% below EMA20
  mirrorDumpAtrMult: 2.5, // treat a red candle as "dump" if range >= 2.5 * ATR
  mirrorDumpLookback: 3, // block Mirror UP if a dump happened within last N candles (excluding last3)

  // Reconfirmation: balanced — fewer vetoes than ultra-strict, still filters worst cases.
  momentumMicroPauseBodyAtrMult: 0.35,
  momentumMicroPauseBodyVsMedianMult: 0.42,
  momentumMaxImpulseRun: 7,

  levelLookbackShort: 10,
  levelLookbackLong: 50,
  // Tighter “near level” = fewer false vetoes at structure (more signals).
  levelNearAtrMult: 0.32,
  levelNearPricePct: 0.00055,

  momentumSameDirWindow: 16,
  momentumMaxSameDirBarsInWindow: 9,

  mirrorMaxGreenBodyAtrMult: 4.0,
  mirrorMaxGreenBodyVsMedianMult: 6.5,
  mirrorMedianBodyLookback: 20,

  dryRun: false,
};

export const config: BotConfig = {
  ...defaults,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};
