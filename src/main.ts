import { config } from "./config.js";
import { signalChartLinks } from "./chart/externalLinks.js";
import { subscribeKline } from "./binance/candleStream.js";
import { fetchKlines } from "./binance/rest.js";
import { appendPredictionLog, appendSignalLog } from "./logger.js";
import { SignalDispatcher } from "./signal/dispatcher.js";
import { evaluate } from "./strategy/engine.js";
import type { Candle } from "./types.js";
import {
  formatPostPredictionTelegramLog,
  formatPrePredictionTelegramLog,
  formatSignalTelegramLog,
  formatVerifyLog,
} from "./logging/verify.js";
import { logRuntime } from "./logging/runtime.js";
import { startTelegramCommandListener } from "./telegram/notify.js";

function trimBuffer(candles: Candle[], max: number): void {
  while (candles.length > max) candles.shift();
}

async function main(): Promise<void> {
  const candles: Candle[] = [];
  const dispatcher = new SignalDispatcher();
  let pendingPrediction:
    | {
        signalId: string;
        predicted: "UP" | "DOWN";
        fromOpenTime: number;
        fromSetup: string;
        baselineClose: number;
      }
    | null = null;

  await logRuntime(
    `[main] ${config.symbol} ${config.interval} — buffer ${config.candleBuffer} — dryRun=${config.dryRun}`,
  );
  void startTelegramCommandListener().catch((e) => {
    console.error("[telegram] command listener failed to start", e);
  });

  try {
    const hist = await fetchKlines(
      config.symbol,
      config.interval,
      config.candleBuffer,
    );
    candles.push(...hist);
    trimBuffer(candles, config.candleBuffer);
    await logRuntime(`[main] bootstrapped ${candles.length} candles from REST`);
  } catch (e) {
    await logRuntime(
      `[main] REST bootstrap failed (will fill from WS only) ${String(e)}`,
      "warn",
    );
  }

  const sub = subscribeKline(config.symbol, config.interval, async (c) => {
    if (pendingPrediction) {
      const expected = pendingPrediction.predicted;
      const actual: "UP" | "DOWN" | "FLAT" =
        c.close > pendingPrediction.baselineClose
          ? "UP"
          : c.close < pendingPrediction.baselineClose
            ? "DOWN"
            : "FLAT";
      const status = actual === expected ? "RIGHT" : "WRONG";
      await logRuntime(
        `[post-prediction] id=${pendingPrediction.signalId} for=${new Date(pendingPrediction.fromOpenTime).toISOString()} baseline_close=${pendingPrediction.baselineClose} next_close=${c.close} expected=${expected} actual=${actual} result=${status} setup=${pendingPrediction.fromSetup}`,
        "log",
        {
          text: formatPostPredictionTelegramLog({
            pair: config.symbol,
            signalId: pendingPrediction.signalId,
            fromOpenTime: pendingPrediction.fromOpenTime,
            baselineClose: pendingPrediction.baselineClose,
            nextOpenTime: c.openTime,
            nextClose: c.close,
            expected,
            actual,
            result: status,
            setup: pendingPrediction.fromSetup,
          }),
          parseMode: "HTML",
        },
      );
      appendPredictionLog({
        signalId: pendingPrediction.signalId,
        ts: new Date().toISOString(),
        fromOpenTime: pendingPrediction.fromOpenTime,
        baselineClose: pendingPrediction.baselineClose,
        nextClose: c.close,
        expected,
        actual,
        result: status,
        setup: pendingPrediction.fromSetup,
      });
      pendingPrediction = null;
    }

    const last = candles[candles.length - 1];
    if (last && last.openTime === c.openTime) {
      candles[candles.length - 1] = c;
    } else {
      candles.push(c);
    }
    trimBuffer(candles, config.candleBuffer);

    const result = evaluate(candles);
    const decision = dispatcher.shouldEmit(c.openTime, result);

    // Verification heartbeat: print one status line for every closed candle.
    // Temporarily disable Telegram spam for candle-by-candle logs.
    await logRuntime(formatVerifyLog(c, result), "log");

    if (!decision.emit) {
      if (result.signal !== "NONE") {
        await logRuntime(
          `[skip] ${new Date(c.openTime).toISOString()} ${result.signal} — ${decision.reason}`,
        );
      }
      return;
    }
    if (result.signal === "NONE") {
      return;
    }

    const signalId = `${c.openTime}-${result.signal}-${result.setup}`;
    const charts = signalChartLinks(config.symbol, config.interval);
    await logRuntime(
      `[signal] id=${signalId} ${new Date(c.openTime).toISOString()} ${result.signal} ${result.setup} — ${result.reason}`,
      "log",
      {
        text: formatSignalTelegramLog(config.symbol, c, result, signalId, charts),
        parseMode: "HTML",
        replyMarkup: charts.replyMarkup,
      },
    );
    pendingPrediction = {
      signalId,
      predicted: result.signal,
      fromOpenTime: c.openTime,
      fromSetup: result.setup,
      baselineClose: c.close,
    };
    await logRuntime(
      `[pre-prediction] id=${signalId} from=${new Date(c.openTime).toISOString()} predict_next=${result.signal} setup=${result.setup} reason=${result.reason}`,
      "log",
      {
        text: formatPrePredictionTelegramLog({
          pair: config.symbol,
          signalId,
          fromOpenTime: c.openTime,
          baselineClose: c.close,
          predicted: result.signal,
          setup: result.setup,
          reason: result.reason,
        }),
        parseMode: "HTML",
      },
    );

    appendSignalLog({
      signalId,
      ts: new Date().toISOString(),
      openTime: c.openTime,
      price: c.close,
      signal: result.signal,
      setup: result.setup,
      reason: result.reason,
    });

    // signal has already been sent through common runtime logger.
  });

  const shutdown = () => {
    sub.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
