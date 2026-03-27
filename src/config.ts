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

  momentumBodyVsAvg: 1.0,
  momentumRangeVsAvg: 0.9,
  minBodyToRange: 0.55,
  maxCloseToExtremePct: 0.25,

  exhaustionRunMin: 4,
  exhaustionRevMinPrevRangeMult: 0.4,
  exhaustionRevMaxPrevRangeMult: 0.7,

  chopLookback: 4,
  lowVolFactor: 0.45,
  lowVolCompare: 20,

  atrPeriod: 14,
  minAtrPct: 0.00005,
  maxAtrPct: 0.03,

  sidewaysEmaPct: 0.001,

  // Mirror (Setup C) guards: avoid fake bounces in strong downtrend / post-dump.
  mirrorMaxBelowEmaPct: 0.002, // allow Mirror UP if close is within 0.2% below EMA20
  mirrorDumpAtrMult: 2.5, // treat a red candle as "dump" if range >= 2.5 * ATR
  mirrorDumpLookback: 3, // block Mirror UP if a dump happened within last N candles (excluding last3)

  dryRun: false,
};

export const config: BotConfig = {
  ...defaults,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
};
