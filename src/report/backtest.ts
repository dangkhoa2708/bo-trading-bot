import type {
  BacktestEmittedRow,
  BacktestResult,
  LiveEligibleSetup,
} from "../backtest/runner.js";

function eligibleModeDescription(setups: LiveEligibleSetup[]): string {
  if (setups.length === 1 && setups[0] === "Exhaustion") {
    return "Exhaustion-only emits";
  }
  if (
    setups.includes("Exhaustion") &&
    setups.includes("Mirror") &&
    setups.length === 2
  ) {
    return "Exhaustion + Mirror emits";
  }
  return `${setups.join(" + ")} emits`;
}

function eligibleSignalsLabel(setups: LiveEligibleSetup[]): string {
  if (setups.length === 1 && setups[0] === "Exhaustion") {
    return "Exhaustion only";
  }
  if (
    setups.includes("Exhaustion") &&
    setups.includes("Mirror") &&
    setups.length === 2
  ) {
    return "Exhaustion + Mirror";
  }
  return setups.join(" + ");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

/** Telegram hard limit 4096; stay under and never slice mid-tag. */
const TELEGRAM_MESSAGE_MAX = 4096;
const TELEGRAM_SAFE_BUDGET = 3900;

const MAX_DETAIL_ROWS_CANDIDATE = 80;

function formatEmittedRowLine(row: BacktestEmittedRow): string {
  const pred =
    row.predictionResult === "RIGHT"
      ? "✅"
      : row.predictionResult === "WRONG"
        ? "❌"
        : "⏳";
  const nextPart =
    row.nextClose !== undefined ? fmtPrice(row.nextClose) : "—";
  return `• ${pred} <code>${escapeHtml(row.time)}</code> <b>${escapeHtml(row.signal)}</b> ${escapeHtml(row.setup)} — baseline <code>${fmtPrice(row.baselineClose)}</code> → next <code>${nextPart}</code> — <i>${escapeHtml(row.reason)}</i>`;
}

/** HTML report for Telegram (aligned with daily/weekly summary shape). */
export function buildBacktestReportHtml(r: BacktestResult): string {
  const d = r.predictionBySetup;
  const dd = r.predictionByDirection;
  const modeLine = `<i>Exact live mode: ${escapeHtml(eligibleModeDescription(r.eligibleSetups))}, same config, same dispatcher, same next-candle scoring.</i>`;
  const signalsSubtitle = escapeHtml(eligibleSignalsLabel(r.eligibleSetups));

  const header = [
    "📉 <b>Backtest</b> <i>(GMT+7)</i>",
    `🗓️ <b>Window</b>: last <code>${r.days}</code> day(s) of closed klines (ending now)`,
    `📎 <code>${escapeHtml(r.windowLabelGmt7)}</code>`,
    "",
    modeLine,
    "",
    "📡 <b>Pair</b>",
    `• <code>${escapeHtml(r.pair)}</code>  <b>TF</b>: <code>${escapeHtml(r.interval)}</code>`,
    `• Klines in window: <code>${r.candleCount}</code>  <i>(+ ${r.candleCountFetched - r.candleCount} for resolving last prediction)</i>`,
    "",
    `📡 <b>Signals</b> <i>(would send live — ${signalsSubtitle})</i>`,
    `• Total: <code>${r.emitted}</code>`,
    `• UP / DOWN: <code>${r.emittedUp} / ${r.emittedDown}</code>`,
    `• Setups: <code>${escapeHtml(r.setups)}</code>`,
    `• Engine UP/DOWN (pre-dispatcher): <code>${r.rawSignals}</code>  • Skipped: <code>${r.skippedByDispatcher}</code>`,
    "",
    "🎯 <b>Emitted</b> <i>next candle vs baseline — same as live Telegram</i>",
    `• Total: <code>${r.predictionTotal}</code>`,
    `• ✅ Right: <code>${r.predictionRight}</code>`,
    `• ❌ Wrong: <code>${r.predictionWrong}</code>`,
    `• 🏆 Win rate: <code>${r.predictionWinRatePct.toFixed(1)}%</code>`,
    "",
    "↕️ <b>By direction (emitted)</b>",
    `• UP: <code>${dd.UP.total}</code> (✅ <code>${dd.UP.right}</code> / ❌ <code>${dd.UP.wrong}</code>) — <code>${dd.UP.winRatePct.toFixed(1)}%</code>`,
    `• DOWN: <code>${dd.DOWN.total}</code> (✅ <code>${dd.DOWN.right}</code> / ❌ <code>${dd.DOWN.wrong}</code>) — <code>${dd.DOWN.winRatePct.toFixed(1)}%</code>`,
    "",
    "🧩 <b>By setup (emitted)</b>",
    `• Momentum: <code>${d.Momentum.total}</code> (✅ <code>${d.Momentum.right}</code> / ❌ <code>${d.Momentum.wrong}</code>) — <code>${d.Momentum.winRatePct.toFixed(1)}%</code>`,
    `• Exhaustion: <code>${d.Exhaustion.total}</code> (✅ <code>${d.Exhaustion.right}</code> / ❌ <code>${d.Exhaustion.wrong}</code>) — <code>${d.Exhaustion.winRatePct.toFixed(1)}%</code>`,
    `• Mirror: <code>${d.Mirror.total}</code> (✅ <code>${d.Mirror.right}</code> / ❌ <code>${d.Mirror.wrong}</code>) — <code>${d.Mirror.winRatePct.toFixed(1)}%</code>`,
    d.Other.total > 0
      ? `• Other: <code>${d.Other.total}</code> (✅ <code>${d.Other.right}</code> / ❌ <code>${d.Other.wrong}</code>) — <code>${d.Other.winRatePct.toFixed(1)}%</code>`
      : "• Other: <code>0</code>",
    "",
    "🪪 <b>Split lanes</b>",
    `• Exhaustion lane: <code>${d.Exhaustion.total}</code> emits — <code>${d.Exhaustion.winRatePct.toFixed(1)}%</code>`,
    `• Mirror lane: <code>${d.Mirror.total}</code> emits — <code>${d.Mirror.winRatePct.toFixed(1)}%</code>`,
  ].join("\n");

  if (r.rows.length === 0) {
    return header;
  }

  const intro =
    "\n\n🧾 <b>Emitted signals</b> <i>(✅/❌ next-candle prediction, ⏳ pending — newest last; list capped by Telegram size)</i>";

  const pool = r.rows.slice(-MAX_DETAIL_ROWS_CANDIDATE);
  const kept: string[] = [];
  let used = header.length + intro.length + 120;
  for (let i = pool.length - 1; i >= 0; i--) {
    const line = formatEmittedRowLine(pool[i]!);
    const add = (kept.length === 0 ? "" : "\n") + line;
    if (used + add.length > TELEGRAM_SAFE_BUDGET) break;
    kept.push(line);
    used += add.length;
  }
  kept.reverse();

  const shown = kept.length;
  const notListed = r.rows.length - shown;
  const tailNote =
    notListed > 0
      ? `\n<i>… ${notListed} emit(s) not listed (Telegram ~${TELEGRAM_MESSAGE_MAX} char limit; showing newest ${shown})</i>`
      : "";

  let text = header + intro + "\n" + kept.join("\n") + tailNote;

  if (text.length > TELEGRAM_MESSAGE_MAX) {
    return (
      header +
      `\n\n<i>Report still too long after trimming. ${r.rows.length} total emits — use fewer days or check logs.</i>`
    );
  }
  return text;
}
