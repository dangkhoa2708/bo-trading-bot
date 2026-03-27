import { BACKTEST_WINDOW_DAYS, type BacktestResult } from "../backtest/runner.js";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const MAX_DETAIL_ROWS = 25;

/** HTML report for Telegram (aligned with daily/weekly summary shape). */
export function buildBacktestReportHtml(r: BacktestResult): string {
  const d = r.predictionBySetup;

  const detailRows = r.rows.slice(-MAX_DETAIL_ROWS);
  const detailBlock =
    detailRows.length > 0
      ? [
          "",
          "🧾 <b>Emitted signals</b> <i>(newest last, capped)</i>",
          ...detailRows.map(
            (row) =>
              `• <code>${escapeHtml(row.time)}</code> <b>${escapeHtml(row.signal)}</b> ${escapeHtml(row.setup)} — <i>${escapeHtml(row.reason)}</i>`,
          ),
          r.rows.length > MAX_DETAIL_ROWS
            ? `<i>… ${r.rows.length - MAX_DETAIL_ROWS} older row(s) omitted</i>`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const text = [
    "📉 <b>Backtest</b> <i>(GMT+7)</i>",
    `🗓️ <b>Window</b>: last <code>${BACKTEST_WINDOW_DAYS}</code> days of closed klines`,
    `📎 <code>${escapeHtml(r.windowLabelGmt7)}</code>`,
    "",
    "<i>Early bars in the window still “warm up” indicators. Predictions use the same next-candle rule as live.</i>",
    "",
    "📡 <b>Pair</b>",
    `• <code>${escapeHtml(r.pair)}</code>  <b>TF</b>: <code>${escapeHtml(r.interval)}</code>`,
    `• Klines in window: <code>${r.candleCount}</code>  <i>(+ ${r.candleCountFetched - r.candleCount} for resolving last prediction)</i>`,
    "",
    "📡 <b>Signals</b> <i>(would send — same dispatcher as live)</i>",
    `• Total: <code>${r.emitted}</code>`,
    `• UP / DOWN: <code>${r.emittedUp} / ${r.emittedDown}</code>`,
    `• Setups: <code>${escapeHtml(r.setups)}</code>`,
    `• Engine UP/DOWN (pre-dispatcher): <code>${r.rawSignals}</code>  • Skipped: <code>${r.skippedByDispatcher}</code>`,
    "",
    "🎯 <b>Predictions</b> <i>(next candle vs baseline close)</i>",
    `• Total: <code>${r.predictionTotal}</code>`,
    `• ✅ Right: <code>${r.predictionRight}</code>`,
    `• ❌ Wrong: <code>${r.predictionWrong}</code>`,
    `• 🏆 Win rate: <code>${r.predictionWinRatePct.toFixed(1)}%</code>`,
    "",
    "🧩 <b>Predictions by setup</b>",
    `• Momentum: <code>${d.Momentum.total}</code> (✅ <code>${d.Momentum.right}</code> / ❌ <code>${d.Momentum.wrong}</code>) — <code>${d.Momentum.winRatePct.toFixed(1)}%</code>`,
    `• Exhaustion: <code>${d.Exhaustion.total}</code> (✅ <code>${d.Exhaustion.right}</code> / ❌ <code>${d.Exhaustion.wrong}</code>) — <code>${d.Exhaustion.winRatePct.toFixed(1)}%</code>`,
    `• Mirror: <code>${d.Mirror.total}</code> (✅ <code>${d.Mirror.right}</code> / ❌ <code>${d.Mirror.wrong}</code>) — <code>${d.Mirror.winRatePct.toFixed(1)}%</code>`,
    d.Other.total > 0
      ? `• Other: <code>${d.Other.total}</code> (✅ <code>${d.Other.right}</code> / ❌ <code>${d.Other.wrong}</code>) — <code>${d.Other.winRatePct.toFixed(1)}%</code>`
      : "• Other: <code>0</code>",
    detailBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const maxLen = 4000;
  if (text.length > maxLen) {
    return text.slice(0, maxLen - 80) + "\n\n<i>… (truncated for Telegram)</i>";
  }
  return text;
}
