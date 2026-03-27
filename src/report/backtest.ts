import { BACKTEST_WINDOW_DAYS, type BacktestResult } from "../backtest/runner.js";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const MAX_DETAIL_ROWS = 25;

/** HTML report for Telegram (same tone as daily/weekly summaries). */
export function buildBacktestReportHtml(r: BacktestResult): string {
  const setupParts = Object.entries(r.bySetup)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

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
    "<i>Early bars in the window still “warm up” indicators (same as a cold-started bot).</i>",
    "",
    "📡 <b>Pair</b>",
    `• <code>${escapeHtml(r.pair)}</code>  <b>TF</b>: <code>${escapeHtml(r.interval)}</code>`,
    `• Klines loaded: <code>${r.candleCount}</code>`,
    "",
    "🎯 <b>Strategy</b> <i>(raw UP/DOWN from engine in window)</i>",
    `• <code>${r.rawSignals}</code>`,
    "",
    "📣 <b>Would send</b> <i>(same dispatcher as live)</i>",
    `• Emitted: <code>${r.emitted}</code>`,
    `• UP / DOWN: <code>${r.emittedUp} / ${r.emittedDown}</code>`,
    `• Skipped by dispatcher: <code>${r.skippedByDispatcher}</code>`,
    "",
    "🧩 <b>Emitted by setup</b>",
    setupParts ? `• <code>${escapeHtml(setupParts)}</code>` : "• <code>—</code>",
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
