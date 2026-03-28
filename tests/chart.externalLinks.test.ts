import { describe, expect, it } from "vitest";
import {
  intervalToTradingView,
  signalChartLinks,
  tradingViewBinanceUrl,
} from "../src/chart/externalLinks.js";

describe("chart external links", () => {
  it("maps Binance interval to TradingView", () => {
    expect(intervalToTradingView("5m")).toBe("5");
    expect(intervalToTradingView("1h")).toBe("60");
    expect(intervalToTradingView("unknown")).toBe("5");
  });

  it("builds TradingView URL for Binance spot with GMT+7 chart timezone", () => {
    expect(tradingViewBinanceUrl("BNBUSDT", "5m")).toBe(
      "https://www.tradingview.com/chart/?symbol=BINANCE%3ABNBUSDT&interval=5&timezone=Asia%2FHo_Chi_Minh",
    );
  });

  it("signalChartLinks returns TradingView URL and Countdown keyboard row", () => {
    const l = signalChartLinks("BNBUSDT", "5m");
    expect(l.tradingViewUrl).toContain("tradingview.com");
    expect(l.replyMarkup.inline_keyboard).toHaveLength(2);
    expect(l.replyMarkup.inline_keyboard[0]).toHaveLength(1);
    expect(l.replyMarkup.inline_keyboard[0][0].url).toBe(l.tradingViewUrl);
    expect(l.replyMarkup.inline_keyboard[0][0].text).toContain("TradingView");
    expect(l.replyMarkup.inline_keyboard[1][0].text).toContain("Countdown");
    expect(l.replyMarkup.inline_keyboard[1][0].url).toContain(
      "pancakeswap.finance/prediction",
    );
  });
});
