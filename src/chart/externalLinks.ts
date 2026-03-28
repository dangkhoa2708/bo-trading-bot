/** Deep links for opening live charts from signal messages (Telegram in-app browser). */

import { PANCAKE_PREDICTION_BNB_PAGE_URL } from "../pancakeswap/urls.js";

export function intervalToTradingView(interval: string): string {
  const map: Record<string, string> = {
    "1m": "1",
    "3m": "3",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "6h": "360",
    "8h": "480",
    "12h": "720",
    "1d": "D",
    "1w": "W",
  };
  return map[interval] ?? "5";
}

function normalizePairSymbol(pair: string): string {
  return pair.replace(/[-\s]/g, "").toUpperCase();
}

/**
 * Chart clock in TradingView (UTC+7, same as `fmtGmt7` / `Asia/Ho_Chi_Minh`).
 * Public chart URLs honor the `timezone` query param.
 */
export const TRADINGVIEW_CHART_TIMEZONE = "Asia/Ho_Chi_Minh";

/** TradingView chart for Binance spot pair, e.g. BNBUSDT → BINANCE:BNBUSDT. */
export function tradingViewBinanceUrl(pair: string, interval: string): string {
  const p = normalizePairSymbol(pair);
  const symbol = encodeURIComponent(`BINANCE:${p}`);
  const tv = intervalToTradingView(interval);
  const tz = encodeURIComponent(TRADINGVIEW_CHART_TIMEZONE);
  return `https://www.tradingview.com/chart/?symbol=${symbol}&interval=${tv}&timezone=${tz}`;
}

export type SignalChartLinks = {
  tradingViewUrl: string;
  replyMarkup: {
    inline_keyboard: Array<Array<{ text: string; url: string }>>;
  };
};

export function signalChartLinks(pair: string, interval: string): SignalChartLinks {
  const tradingViewUrl = tradingViewBinanceUrl(pair, interval);
  return {
    tradingViewUrl,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "📊 TradingView", url: tradingViewUrl }],
        [{ text: "⏱ Countdown", url: PANCAKE_PREDICTION_BNB_PAGE_URL }],
      ],
    },
  };
}
