import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { signalChartLinks } from "./chart/externalLinks.js";
import { subscribeKline } from "./binance/candleStream.js";
import { fetchKlines } from "./binance/rest.js";
import { appendPredictionLog, appendSignalLog } from "./logger.js";
import { SignalDispatcher } from "./signal/dispatcher.js";
import { evaluate } from "./strategy/engine.js";
import type { Candle } from "./types.js";
import {
  formatPrePredictionTelegramLog,
  prePredictionReplyMarkup,
  formatSignalTelegramLog,
  formatVerifyLog,
} from "./logging/verify.js";
import {
  fetchPancakePredictionBnbCountdown,
  formatPancakeCountdownSignalSnippetHtml,
} from "./pancakeswap/predictionCountdown.js";
import {
  consumeHumanPickForBar,
  registerAwaitingHumanPick,
} from "./prediction/humanPick.js";
import { hasRecordedPancakeBetForPrediction } from "./pancakeswap/hasBetForPrediction.js";
import { pullFakeSignalIfQueued } from "./prediction/injectedFakeSignal.js";
import { logRuntime } from "./logging/runtime.js";
import { startPancakeOutcomePoller } from "./pancakeswap/outcomePoller.js";
import {
  sendSignalReminderPings,
  sendTelegramText,
  startTelegramCommandListener,
} from "./telegram/notify.js";

function trimBuffer(candles: Candle[], max: number): void {
  while (candles.length > max) candles.shift();
}

async function main(): Promise<void> {
  const candles: Candle[] = [];
  const dispatcher = new SignalDispatcher();
  let pendingPrediction:
    | {
        signalId: string;
        predictionId: string;
        predicted: "UP" | "DOWN";
        fromOpenTime: number;
        fromSetup: string;
        baselineClose: number;
      }
    | null = null;

  await logRuntime(
    `[main] ${config.symbol} ${config.interval} — buffer ${config.candleBuffer} — dryRun=${config.dryRun}`,
  );
  if (config.telegramBotToken && config.telegramChatId && !config.dryRun) {
    startPancakeOutcomePoller(sendTelegramText);
  }
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
    if (!pendingPrediction) {
      const inj = pullFakeSignalIfQueued();
      if (inj) {
        pendingPrediction = {
          signalId: inj.signalId,
          predictionId: inj.predictionId,
          predicted: inj.predicted,
          fromOpenTime: inj.fromOpenTime,
          fromSetup: inj.fromSetup,
          baselineClose: inj.baselineClose,
        };
      }
    }
    if (pendingPrediction) {
      const botExpected = pendingPrediction.predicted;
      const humanPick = consumeHumanPickForBar(
        pendingPrediction.fromOpenTime,
      );
      const humanPickOrNull = humanPick ?? null;
      const scoredExpected = humanPick ?? botExpected;
      const actual: "UP" | "DOWN" | "FLAT" =
        c.close > pendingPrediction.baselineClose
          ? "UP"
          : c.close < pendingPrediction.baselineClose
            ? "DOWN"
            : "FLAT";
      const candleScore = actual === scoredExpected ? "RIGHT" : "WRONG";
      const hadBet = hasRecordedPancakeBetForPrediction(
        pendingPrediction.predictionId,
        pendingPrediction.signalId,
      );
      await logRuntime(
        `[prediction-resolve] id=${pendingPrediction.signalId} for=${new Date(pendingPrediction.fromOpenTime).toISOString()} baseline_close=${pendingPrediction.baselineClose} next_close=${c.close} bot=${botExpected} human=${humanPickOrNull ?? "—"} scored=${scoredExpected} actual=${actual} candle=${candleScore} hadPancakeBet=${hadBet} setup=${pendingPrediction.fromSetup}`,
        "log",
      );
      appendPredictionLog({
        signalId: pendingPrediction.signalId,
        predictionId: pendingPrediction.predictionId,
        ts: new Date().toISOString(),
        fromOpenTime: pendingPrediction.fromOpenTime,
        baselineClose: pendingPrediction.baselineClose,
        nextClose: c.close,
        expected: scoredExpected,
        botExpected,
        humanPick: humanPickOrNull,
        actual,
        result: hadBet ? "PLACEMENT" : "IGNORED",
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

    if (decision.emit && result.signal !== "NONE") {
      const predictionId = randomUUID();
      const signalId = `${c.openTime}-${result.signal}-${result.setup}`;
      const charts = signalChartLinks(config.symbol, config.interval);
      const pancakeCd = await fetchPancakePredictionBnbCountdown(config.bscRpcUrl);
      await logRuntime(
        `[signal] id=${signalId} ${new Date(c.openTime).toISOString()} ${result.signal} ${result.setup} — ${result.reason}`,
        "log",
        {
          text: formatSignalTelegramLog(config.symbol, c, result, signalId, {
            extraHtmlBeforeChart: formatPancakeCountdownSignalSnippetHtml(pancakeCd),
          }),
          parseMode: "HTML",
          replyMarkup: charts.replyMarkup,
        },
      );
      pendingPrediction = {
        signalId,
        predictionId,
        predicted: result.signal,
        fromOpenTime: c.openTime,
        fromSetup: result.setup,
        baselineClose: c.close,
      };
      registerAwaitingHumanPick(c.openTime, { signalId, predictionId });
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
          replyMarkup: prePredictionReplyMarkup(c.openTime),
        },
      );
      await sendSignalReminderPings();

      appendSignalLog({
        signalId,
        predictionId,
        ts: new Date().toISOString(),
        openTime: c.openTime,
        price: c.close,
        signal: result.signal,
        setup: result.setup,
        reason: result.reason,
      });
    } else if (!decision.emit && result.signal !== "NONE") {
      await logRuntime(
        `[skip] ${new Date(c.openTime).toISOString()} ${result.signal} — ${decision.reason}`,
      );
    }
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
