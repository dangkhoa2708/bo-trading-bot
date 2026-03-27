import { config } from "./config.js";
import { subscribeKline } from "./binance/candleStream.js";
import { fetchKlines } from "./binance/rest.js";
import { appendPredictionLog, appendSignalLog } from "./logger.js";
import { SignalDispatcher } from "./signal/dispatcher.js";
import { evaluate } from "./strategy/engine.js";
import type { Candle } from "./types.js";
import { formatVerifyLog, formatVerifyTelegramLog } from "./logging/verify.js";
import { logRuntime } from "./logging/runtime.js";

function trimBuffer(candles: Candle[], max: number): void {
  while (candles.length > max) candles.shift();
}

async function main(): Promise<void> {
  const candles: Candle[] = [];
  const dispatcher = new SignalDispatcher();
  let pendingPrediction:
    | {
        predicted: "UP" | "DOWN";
        fromOpenTime: number;
        fromSetup: string;
        baselineClose: number;
      }
    | null = null;

  await logRuntime(
    `[main] ${config.symbol} ${config.interval} — buffer ${config.candleBuffer} — dryRun=${config.dryRun}`,
  );

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
        `[post-prediction] for=${new Date(pendingPrediction.fromOpenTime).toISOString()} baseline_close=${pendingPrediction.baselineClose} next_close=${c.close} expected=${expected} actual=${actual} result=${status} setup=${pendingPrediction.fromSetup}`,
      );
      appendPredictionLog({
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
    await logRuntime(formatVerifyLog(c, result), "log", {
      text: formatVerifyTelegramLog(c, result),
      parseMode: "HTML",
    });

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

    await logRuntime(
      `[signal] ${new Date(c.openTime).toISOString()} ${result.signal} ${result.setup} — ${result.reason}`,
    );
    pendingPrediction = {
      predicted: result.signal,
      fromOpenTime: c.openTime,
      fromSetup: result.setup,
      baselineClose: c.close,
    };
    await logRuntime(
      `[pre-prediction] from=${new Date(c.openTime).toISOString()} predict_next=${result.signal} setup=${result.setup} reason=${result.reason}`,
    );

    appendSignalLog({
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
