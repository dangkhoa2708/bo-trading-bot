/**
 * One-shot backtest for local/CI:
 * - `npx tsx scripts/run-backtest-cli.ts [days]`
 * - `npx tsx scripts/run-backtest-cli.ts [days] exhaustion` — Exhaustion-only diagnostic
 * Default: 30 days (max 90, same as Telegram /backtest), using Exhaustion + Mirror split lanes.
 */
import { runBacktest } from "../src/backtest/runner.js";
import { buildBacktestReportHtml } from "../src/report/backtest.js";

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

const daysArg = process.argv[2];
const days =
  daysArg && /^\d+$/.test(daysArg)
    ? Math.max(1, Math.min(90, parseInt(daysArg, 10)))
    : 30;

const mode = process.argv[3]?.toLowerCase();
const eligibleSetups =
  mode === "exhaustion"
    ? (["Exhaustion"] as const)
    : (["Exhaustion", "Mirror"] as const);

const r = await runBacktest({ days, eligibleSetups: [...eligibleSetups] });
if (!r.ok) {
  console.error("Backtest failed:", r.message);
  process.exit(1);
}
console.log(stripHtml(buildBacktestReportHtml(r)));
