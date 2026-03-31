/**
 * One-shot backtest for local/CI: `npx tsx scripts/run-backtest-cli.ts [days]`
 * Default: 30 days (max 90, same as Telegram /backtest).
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

const r = await runBacktest({ days });
if (!r.ok) {
  console.error("Backtest failed:", r.message);
  process.exit(1);
}
console.log(stripHtml(buildBacktestReportHtml(r)));
