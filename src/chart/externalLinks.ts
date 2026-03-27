/** Deep links for opening live charts from signal messages (Telegram in-app browser). */

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

/** TradingView chart for Binance spot pair, e.g. BNBUSDT → BINANCE:BNBUSDT. */
export function tradingViewBinanceUrl(pair: string, interval: string): string {
  const p = normalizePairSymbol(pair);
  const symbol = encodeURIComponent(`BINANCE:${p}`);
  const tv = intervalToTradingView(interval);
  return `https://www.tradingview.com/chart/?symbol=${symbol}&interval=${tv}`;
}

/** Binance spot trade page (includes chart). */
export function binanceSpotTradeUrl(pair: string): string {
  const p = normalizePairSymbol(pair);
  if (p.endsWith("USDT")) {
    const base = p.slice(0, -4);
    return `https://www.binance.com/en/trade/${base}_USDT`;
  }
  if (p.endsWith("USDC")) {
    const base = p.slice(0, -4);
    return `https://www.binance.com/en/trade/${base}_USDC`;
  }
  if (p.endsWith("BUSD")) {
    const base = p.slice(0, -4);
    return `https://www.binance.com/en/trade/${base}_BUSD`;
  }
  return `https://www.binance.com/en/trade/${p}`;
}

export type SignalChartLinks = {
  tradingViewUrl: string;
  binanceTradeUrl: string;
  replyMarkup: {
    inline_keyboard: Array<Array<{ text: string; url: string }>>;
  };
};

export function signalChartLinks(pair: string, interval: string): SignalChartLinks {
  const tradingViewUrl = tradingViewBinanceUrl(pair, interval);
  const binanceTradeUrl = binanceSpotTradeUrl(pair);
  return {
    tradingViewUrl,
    binanceTradeUrl,
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "📊 TradingView", url: tradingViewUrl },
          { text: "📈 Binance", url: binanceTradeUrl },
        ],
      ],
    },
  };
}
