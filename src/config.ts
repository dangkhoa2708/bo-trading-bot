import "dotenv/config";

const num = (v: string | undefined, fallback: number) => {
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  symbol: process.env.SYMBOL ?? "BNBUSDT",
  interval: process.env.INTERVAL ?? "5m",
  candleBuffer: num(process.env.CANDLE_BUFFER, 50),
  emaPeriod: num(process.env.EMA_PERIOD, 20),
  bodyLookback: num(process.env.BODY_LOOKBACK, 20),
  /** Momentum: each of last 3 bodies must be >= this × avg body */
  momentumBodyVsAvg: num(process.env.MOMENTUM_BODY_VS_AVG, 1.0),
  /** Momentum: each of last 3 ranges must be >= this × avg range */
  momentumRangeVsAvg: num(process.env.MOMENTUM_RANGE_VS_AVG, 0.9),
  /** Body must be at least this fraction of full range (small wicks) */
  minBodyToRange: num(process.env.MIN_BODY_TO_RANGE, 0.55),
  /**
   * Close must be near extreme in trend direction:
   * - green: (high-close)/range <= threshold
   * - red:   (close-low)/range <= threshold
   */
  maxCloseToExtremePct: num(process.env.MAX_CLOSE_TO_EXTREME_PCT, 0.25),
  /** Exhaustion run length (same color) */
  exhaustionRunMin: num(process.env.EXHAUSTION_RUN_MIN, 4),
  /** Exhaustion: reversal range should be within previous range × [min, max] */
  exhaustionRevMinPrevRangeMult: num(
    process.env.EXHAUSTION_REV_MIN_PREV_RANGE_MULT,
    0.4,
  ),
  exhaustionRevMaxPrevRangeMult: num(
    process.env.EXHAUSTION_REV_MAX_PREV_RANGE_MULT,
    0.7,
  ),
  /** Skip: "choppy" if last N candles alternate color */
  chopLookback: num(process.env.CHOP_LOOKBACK, 4),
  /** Skip: low vol if median range < factor × median of longer window */
  lowVolFactor: num(process.env.LOW_VOL_FACTOR, 0.45),
  lowVolCompare: num(process.env.LOW_VOL_COMPARE, 20),
  /** ATR volatility filter */
  atrPeriod: num(process.env.ATR_PERIOD, 14),
  minAtrPct: num(process.env.MIN_ATR_PCT, 0.00005),
  maxAtrPct: num(process.env.MAX_ATR_PCT, 0.03),
  /** Skip: sideways if |close - EMA| / close < this */
  sidewaysEmaPct: num(process.env.SIDEWAYS_EMA_PCT, 0.001),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
  dryRun: process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true",
};
