import fs from "node:fs";
import path from "node:path";
import { formatEther } from "viem";
import { fmtGmt7, gmt7DateKey } from "../time/utils.js";
import {
  buildDualPredictionStats,
  scoreRowVsBot,
  scoreRowVsMyPick,
  type DualPredictionSection,
} from "./predictionStats.js";
import {
  buildPancakePlacementsDetailsHtml,
  buildPancakePlacementsSummaryHtmlLines,
  filterPlacementsForSignalDetail,
  formatLinkedPlacementsDetailHtml,
  loadPancakePlacementsForGmt7Day,
  type PancakePlacementAggregate,
} from "./pancakePlacementReport.js";
import { escapeHtml } from "../logging/verify.js";
import {
  filterPancakeAggregateExcludingFakeSignals,
  isFakeSignalPredictionRow,
  isFakeSignalSetup,
} from "./reportFilters.js";

type SignalRow = {
  signalId?: string;
  predictionId?: string;
  ts: string;
  openTime: number;
  price: number;
  signal: "UP" | "DOWN" | "NONE" | string;
  setup: string;
  reason: string;
};

type PredictionRow = {
  signalId?: string;
  predictionId?: string;
  ts: string;
  fromOpenTime: number;
  baselineClose: number;
  nextClose: number;
  expected: "UP" | "DOWN" | string;
  botExpected?: "UP" | "DOWN";
  humanPick?: "UP" | "DOWN" | null;
  actual: "UP" | "DOWN" | "FLAT" | string;
  result?: "RIGHT" | "WRONG" | "IGNORED" | "PLACEMENT" | string;
  setup?: string;
};

type DetailItem = {
  index: number;
  signalId: string;
  /** Shared id across <code>signals.jsonl</code> and <code>predictions.jsonl</code> when present. */
  predictionId?: string;
  time: string;
  openTime: string;
  close: number;
  signal: string;
  setup: string;
  reason: string;
  prediction: string;
  /** Stored score (human if set, else bot). */
  result: string;
  resultVsBot: string;
  resultVsMyPick: string;
  baselineClose: number | null;
  nextClose: number | null;
  /** HTML lines for Pancake placements linked to this signal / prediction. */
  linkedPancakeHtml: string;
  /** Plain text (CLI) for linked placements. */
  linkedPancakeText: string;
};

type DailyReportData = {
  hasLogs: boolean;
  date: string;
  signalTotal: number;
  up: number;
  down: number;
  setups: string;
  /** Predictions closed with no Pancake bet (excluded from candle win-rate blocks). */
  ignoredNoBetCount: number;
  /** Predictions where a bet was recorded (outcome in Pancake / ledger, not candle stats). */
  placementResolvedCount: number;
  /** Next-candle scores vs bot direction only. */
  botPrediction: DualPredictionSection;
  /** Next-candle scores vs your Telegram pick (recorded picks only). */
  myPicks: DualPredictionSection;
  details: DetailItem[];
  /** Settled Pancake on-chain placements (GMT+7 day). */
  pancake: PancakePlacementAggregate;
};

function safeParse<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function todayKeyGmt7(): string {
  return gmt7DateKey(Date.now());
}

function parseTodayRows<T extends { ts: string }>(
  file: string,
  today: string,
): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const rows = lines
    .map((line) => safeParse<T>(line))
    .filter((r): r is T => r !== null);
  return rows.filter((r) => {
    const ms = Date.parse(r.ts);
    if (!Number.isFinite(ms)) return false;
    return gmt7DateKey(ms) === today;
  });
}

function buildDailyReportData(): DailyReportData {
  const signalFile = path.join(process.cwd(), "logs", "signals.jsonl");
  const predictionFile = path.join(process.cwd(), "logs", "predictions.jsonl");
  const today = todayKeyGmt7();
  const pancake = filterPancakeAggregateExcludingFakeSignals(
    loadPancakePlacementsForGmt7Day(today),
  );
  const emptySection = (): DualPredictionSection => ({
    total: 0,
    right: 0,
    wrong: 0,
    winRatePct: 0,
    bySetup: {
      Momentum: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
      Exhaustion: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
      Mirror: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
      Other: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    },
  });

  const signalExists = fs.existsSync(signalFile);
  const predExists = fs.existsSync(predictionFile);
  if (!signalExists && !predExists && pancake.count === 0) {
    return {
      hasLogs: false,
      date: today,
      signalTotal: 0,
      up: 0,
      down: 0,
      setups: "-",
      ignoredNoBetCount: 0,
      placementResolvedCount: 0,
      botPrediction: emptySection(),
      myPicks: emptySection(),
      details: [],
      pancake,
    };
  }

  const todaySignals = signalExists
    ? parseTodayRows<SignalRow>(signalFile, today)
    : [];
  const todayPredictions = predExists
    ? parseTodayRows<PredictionRow>(predictionFile, today)
    : [];
  const reportSignals = todaySignals.filter((r) => !isFakeSignalSetup(r.setup));
  const reportPredictions = todayPredictions.filter((p) =>
    !isFakeSignalPredictionRow(p),
  );

  const up = reportSignals.filter((r) => r.signal === "UP").length;
  const down = reportSignals.filter((r) => r.signal === "DOWN").length;
  const bySetup = new Map<string, number>();
  for (const r of reportSignals) {
    bySetup.set(r.setup, (bySetup.get(r.setup) ?? 0) + 1);
  }
  const setupParts = [...bySetup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const predByFromOpen = new Map<number, PredictionRow>();
  const predBySignalId = new Map<string, PredictionRow>();
  for (const p of reportPredictions) {
    predByFromOpen.set(p.fromOpenTime, p);
    if (p.signalId) predBySignalId.set(p.signalId, p);
  }

  const setupBySignalId = new Map<string, string>();
  for (const s of reportSignals) {
    const sid = s.signalId ?? `${s.openTime}-${s.signal}-${s.setup}`;
    setupBySignalId.set(sid, s.setup);
  }

  const dual = buildDualPredictionStats(reportPredictions, (p) =>
    p.setup && p.setup.trim()
      ? p.setup
      : p.signalId
        ? (setupBySignalId.get(p.signalId) ?? "Other")
        : "Other",
  );

  const ignoredNoBetCount = reportPredictions.filter(
    (p) => p.result === "IGNORED",
  ).length;
  const placementResolvedCount = reportPredictions.filter(
    (p) => p.result === "PLACEMENT",
  ).length;

  const details: DetailItem[] = reportSignals.map((s, idx) => {
    const sid = s.signalId ?? `${s.openTime}-${s.signal}-${s.setup}`;
    const p = predBySignalId.get(sid) ?? predByFromOpen.get(s.openTime);
    const predictionId = p?.predictionId ?? s.predictionId;
    const linkedPlacements = filterPlacementsForSignalDetail(pancake.rows, {
      signalId: sid,
      predictionId,
    });
    const linkedPancakeHtml = formatLinkedPlacementsDetailHtml(linkedPlacements);
    const linkedPancakeText =
      linkedPlacements.length === 0
        ? ""
        : linkedPlacements
            .map(
              (pl) =>
                `  • Pancake ${pl.placementId.slice(0, 8)}… ${pl.outcome} · P&L ${pl.profitBnb} BNB`,
            )
            .join("\n");
    return {
      index: idx + 1,
      signalId: sid,
      predictionId,
      time: fmtGmt7(Date.parse(s.ts)),
      openTime: fmtGmt7(s.openTime),
      close: s.price,
      signal: s.signal,
      setup: s.setup,
      reason: s.reason,
      prediction: p
        ? p.result === "IGNORED"
          ? "— (no on-chain bet · ignored)"
          : p.result === "PLACEMENT"
            ? "— (bet placed · see Pancake / ledger)"
            : ((): string => {
                let t = `${p.expected} → ${p.actual}`;
                if (p.botExpected !== undefined) {
                  t += ` · bot ${p.botExpected}`;
                  t +=
                    p.humanPick != null ? ` · you ${p.humanPick}` : ` · you —`;
                }
                return t;
              })()
        : "PENDING",
      result: p ? (p.result ?? "PENDING") : "PENDING",
      resultVsBot: p ? (scoreRowVsBot(p) ?? "—") : "PENDING",
      resultVsMyPick: p ? (scoreRowVsMyPick(p) ?? "—") : "PENDING",
      baselineClose: p ? p.baselineClose : null,
      nextClose: p ? p.nextClose : null,
      linkedPancakeHtml,
      linkedPancakeText,
    };
  });

  const hasLogs =
    reportSignals.length > 0 ||
    reportPredictions.length > 0 ||
    pancake.count > 0;

  return {
    hasLogs,
    date: today,
    signalTotal: reportSignals.length,
    up,
    down,
    setups: setupParts || "-",
    ignoredNoBetCount,
    placementResolvedCount,
    botPrediction: dual.bot,
    myPicks: dual.myPicks,
    details,
    pancake,
  };
}

export function buildDailyReportLines(): string[] {
  const d = buildDailyReportData();
  if (!d.hasLogs) return ["[daily-report] no logs found in logs/"];

  const detailLines: string[] = [];
  if (d.details.length > 0) {
    detailLines.push("", "Details");
    for (const item of d.details) {
      detailLines.push("------------------------------------------------------");
      detailLines.push(`Signal ${item.index}`);
      detailLines.push(`  SignalId    : ${item.signalId}`);
      detailLines.push(`  Time        : ${item.time}`);
      detailLines.push(`  OpenTime    : ${item.openTime}`);
      detailLines.push(`  Close       : ${item.close.toFixed(2)}`);
      detailLines.push(`  Signal      : ${item.signal} (${item.setup})`);
      detailLines.push(`  Prediction  : ${item.prediction}`);
      detailLines.push(`  Result (log): ${item.result}`);
      detailLines.push(`  vs bot      : ${item.resultVsBot}`);
      detailLines.push(`  vs my pick  : ${item.resultVsMyPick}`);
      detailLines.push(
        `  Baseline/Next: ${
          item.baselineClose !== null && item.nextClose !== null
            ? `${item.baselineClose.toFixed(2)} -> ${item.nextClose.toFixed(2)}`
            : "PENDING"
        }`,
      );
      detailLines.push(`  Reason      : ${item.reason}`);
      if (item.predictionId) {
        detailLines.push(`  PredictionId: ${item.predictionId}`);
      }
      if (item.linkedPancakeText) {
        detailLines.push("  On-chain (Pancake):");
        detailLines.push(item.linkedPancakeText);
      }
    }
  }

  return [
    "================ DAILY REPORT (GMT+7) ================",
    `Date        : ${d.date}`,
    "",
    "Signals",
    `  Total     : ${d.signalTotal}`,
    `  UP / DOWN : ${d.up} / ${d.down}`,
    `  Setups    : ${d.setups}`,
    "",
    "Prediction resolution",
    `  Ignored (no bet) : ${d.ignoredNoBetCount}`,
    `  With Pancake bet : ${d.placementResolvedCount}`,
    "",
    "Bot prediction (vs next close)",
    `  Total     : ${d.botPrediction.total}`,
    `  Right     : ${d.botPrediction.right}`,
    `  Wrong     : ${d.botPrediction.wrong}`,
    `  Win rate  : ${d.botPrediction.winRatePct.toFixed(1)}%`,
    "",
    "  By setup",
    `  Momentum   : ${d.botPrediction.bySetup.Momentum.total} (✅ ${d.botPrediction.bySetup.Momentum.right} / ❌ ${d.botPrediction.bySetup.Momentum.wrong}) ${d.botPrediction.bySetup.Momentum.winRatePct.toFixed(1)}%`,
    `  Exhaustion : ${d.botPrediction.bySetup.Exhaustion.total} (✅ ${d.botPrediction.bySetup.Exhaustion.right} / ❌ ${d.botPrediction.bySetup.Exhaustion.wrong}) ${d.botPrediction.bySetup.Exhaustion.winRatePct.toFixed(1)}%`,
    `  Mirror     : ${d.botPrediction.bySetup.Mirror.total} (✅ ${d.botPrediction.bySetup.Mirror.right} / ❌ ${d.botPrediction.bySetup.Mirror.wrong}) ${d.botPrediction.bySetup.Mirror.winRatePct.toFixed(1)}%`,
    d.botPrediction.bySetup.Other.total > 0
      ? `  Other      : ${d.botPrediction.bySetup.Other.total} (✅ ${d.botPrediction.bySetup.Other.right} / ❌ ${d.botPrediction.bySetup.Other.wrong}) ${d.botPrediction.bySetup.Other.winRatePct.toFixed(1)}%`
      : "  Other      : 0",
    "",
    "My picks (Telegram button only)",
    `  Total     : ${d.myPicks.total}`,
    `  Right     : ${d.myPicks.right}`,
    `  Wrong     : ${d.myPicks.wrong}`,
    `  Win rate  : ${d.myPicks.total > 0 ? d.myPicks.winRatePct.toFixed(1) : "—"}%`,
    "",
    "  By setup",
    `  Momentum   : ${d.myPicks.bySetup.Momentum.total} (✅ ${d.myPicks.bySetup.Momentum.right} / ❌ ${d.myPicks.bySetup.Momentum.wrong}) ${d.myPicks.bySetup.Momentum.total > 0 ? d.myPicks.bySetup.Momentum.winRatePct.toFixed(1) : "—"}%`,
    `  Exhaustion : ${d.myPicks.bySetup.Exhaustion.total} (✅ ${d.myPicks.bySetup.Exhaustion.right} / ❌ ${d.myPicks.bySetup.Exhaustion.wrong}) ${d.myPicks.bySetup.Exhaustion.total > 0 ? d.myPicks.bySetup.Exhaustion.winRatePct.toFixed(1) : "—"}%`,
    `  Mirror     : ${d.myPicks.bySetup.Mirror.total} (✅ ${d.myPicks.bySetup.Mirror.right} / ❌ ${d.myPicks.bySetup.Mirror.wrong}) ${d.myPicks.bySetup.Mirror.total > 0 ? d.myPicks.bySetup.Mirror.winRatePct.toFixed(1) : "—"}%`,
    d.myPicks.bySetup.Other.total > 0
      ? `  Other      : ${d.myPicks.bySetup.Other.total} (✅ ${d.myPicks.bySetup.Other.right} / ❌ ${d.myPicks.bySetup.Other.wrong}) ${d.myPicks.bySetup.Other.winRatePct.toFixed(1)}%`
      : "  Other      : 0",
    ...(d.pancake.count > 0
      ? [
          "",
          "Pancake placements (settled)",
          `  Count     : ${d.pancake.count}`,
          `  Stake BNB : ${formatEther(d.pancake.totalBetWei)}  (USDT ≈ at settle: ${d.pancake.sumStakeUsdt === null ? "—" : d.pancake.sumStakeUsdt.toFixed(2)})`,
          `  Claim BNB : ${formatEther(d.pancake.totalClaimWei)}  (USDT ≈ at settle: ${d.pancake.sumClaimUsdt === null ? "—" : d.pancake.sumClaimUsdt.toFixed(2)})`,
          `  P&L BNB   : ${formatEther(d.pancake.totalProfitWei)}  (USDT ≈ at settle: ${d.pancake.sumProfitUsdt === null ? "—" : d.pancake.sumProfitUsdt.toFixed(2)})`,
        ]
      : []),
    ...detailLines,
    "======================================================",
  ];
}

/** Telegram HTML: summary only (no per-signal block). */
export function buildDailyReportSummaryHtml(): string {
  const d = buildDailyReportData();
  if (!d.hasLogs) {
    return "📊 <b>Daily Report</b> (GMT+7)\nNo logs found yet.";
  }

  const header = buildDailyReportHeaderLinesHtml(d);
  if (d.details.length > 0 || d.pancake.count > 0) {
    header.push(
      "",
      `• <i>${d.details.length} per-signal row(s), ${d.pancake.count} Pancake placement(s) — tap <b>Show details</b> for breakdown.</i>`,
    );
  }
  return header.filter(Boolean).join("\n");
}

function buildDailyReportHeaderLinesHtml(d: DailyReportData): string[] {
  const bot = d.botPrediction;
  const my = d.myPicks;
  const mb = my.total > 0 ? my.winRatePct.toFixed(1) : "—";
  const base = [
    "📊 <b>Daily Report</b> <i>(GMT+7)</i>",
    `🗓️ Date: <code>${d.date}</code>`,
    "",
    "📡 <b>Signals</b>",
    `• Total: <code>${d.signalTotal}</code>`,
    `• UP / DOWN: <code>${d.up} / ${d.down}</code>`,
    `• Setups: <code>${d.setups}</code>`,
    "",
    "🧮 <b>Prediction resolution</b>",
    `• Ignored <i>(no on-chain bet)</i>: <code>${d.ignoredNoBetCount}</code>`,
    `• With Pancake bet <i>(outcome on-chain)</i>: <code>${d.placementResolvedCount}</code>`,
    "",
    "🤖 <b>Bot prediction</b> <i>(candle score — legacy rows only)</i>",
    `• Total: <code>${bot.total}</code>`,
    `• ✅ Right: <code>${bot.right}</code>`,
    `• ❌ Wrong: <code>${bot.wrong}</code>`,
    `• 🏆 Win rate: <code>${bot.winRatePct.toFixed(1)}%</code>`,
    "",
    "🧩 <b>Bot — by setup</b>",
    `• Momentum: <code>${bot.bySetup.Momentum.total}</code> (✅ <code>${bot.bySetup.Momentum.right}</code> / ❌ <code>${bot.bySetup.Momentum.wrong}</code>) — <code>${bot.bySetup.Momentum.winRatePct.toFixed(1)}%</code>`,
    `• Exhaustion: <code>${bot.bySetup.Exhaustion.total}</code> (✅ <code>${bot.bySetup.Exhaustion.right}</code> / ❌ <code>${bot.bySetup.Exhaustion.wrong}</code>) — <code>${bot.bySetup.Exhaustion.winRatePct.toFixed(1)}%</code>`,
    `• Mirror: <code>${bot.bySetup.Mirror.total}</code> (✅ <code>${bot.bySetup.Mirror.right}</code> / ❌ <code>${bot.bySetup.Mirror.wrong}</code>) — <code>${bot.bySetup.Mirror.winRatePct.toFixed(1)}%</code>`,
    bot.bySetup.Other.total > 0
      ? `• Other: <code>${bot.bySetup.Other.total}</code> (✅ <code>${bot.bySetup.Other.right}</code> / ❌ <code>${bot.bySetup.Other.wrong}</code>) — <code>${bot.bySetup.Other.winRatePct.toFixed(1)}%</code>`
      : "",
    "",
    "🧑‍💻 <b>My picks</b> <i>(Telegram buttons · candle score, legacy rows only)</i>",
    `• Total: <code>${my.total}</code>`,
    `• ✅ Right: <code>${my.right}</code>`,
    `• ❌ Wrong: <code>${my.wrong}</code>`,
    `• 🏆 Win rate: <code>${mb}%</code>`,
    "",
    "🧩 <b>My picks — by setup</b>",
    `• Momentum: <code>${my.bySetup.Momentum.total}</code> (✅ <code>${my.bySetup.Momentum.right}</code> / ❌ <code>${my.bySetup.Momentum.wrong}</code>) — <code>${my.bySetup.Momentum.total > 0 ? my.bySetup.Momentum.winRatePct.toFixed(1) : "—"}%</code>`,
    `• Exhaustion: <code>${my.bySetup.Exhaustion.total}</code> (✅ <code>${my.bySetup.Exhaustion.right}</code> / ❌ <code>${my.bySetup.Exhaustion.wrong}</code>) — <code>${my.bySetup.Exhaustion.total > 0 ? my.bySetup.Exhaustion.winRatePct.toFixed(1) : "—"}%</code>`,
    `• Mirror: <code>${my.bySetup.Mirror.total}</code> (✅ <code>${my.bySetup.Mirror.right}</code> / ❌ <code>${my.bySetup.Mirror.wrong}</code>) — <code>${my.bySetup.Mirror.total > 0 ? my.bySetup.Mirror.winRatePct.toFixed(1) : "—"}%</code>`,
    my.bySetup.Other.total > 0
      ? `• Other: <code>${my.bySetup.Other.total}</code> (✅ <code>${my.bySetup.Other.right}</code> / ❌ <code>${my.bySetup.Other.wrong}</code>) — <code>${my.bySetup.Other.winRatePct.toFixed(1)}%</code>`
      : "",
  ].filter((line) => line !== "");
  return [...base, ...buildPancakePlacementsSummaryHtmlLines(d.pancake)];
}

const TELEGRAM_DETAILS_MAX_CHARS = 3600;

function buildDailyReportDetailsHtmlForData(d: DailyReportData): string {
  if (!d.hasLogs) return "";
  const parts: string[] = [];
  if (d.details.length > 0) {
    parts.push("", "🧾 <b>Details</b>");
    for (const item of d.details) {
      parts.push(
        `<b>Signal ${item.index}</b>`,
        `• SignalId: <code>${item.signalId}</code>`,
        `• Time: <code>${item.time}</code>`,
        `• OpenTime: <code>${item.openTime}</code>`,
        `• Close: <code>${item.close.toFixed(2)}</code>`,
        `• Signal: <code>${item.signal} (${item.setup})</code>`,
        `• Prediction: <code>${item.prediction}</code>`,
        `• Result (logged): <b>${item.result}</b>`,
        `• vs bot: <b>${item.resultVsBot}</b>`,
        `• vs my pick: <b>${item.resultVsMyPick}</b>`,
        `• Baseline/Next: <code>${
          item.baselineClose !== null && item.nextClose !== null
            ? `${item.baselineClose.toFixed(2)} -> ${item.nextClose.toFixed(2)}`
            : "PENDING"
        }</code>`,
        `• Reason: <i>${item.reason}</i>`,
        ...(item.predictionId
          ? [`• predictionId: <code>${escapeHtml(item.predictionId)}</code>`]
          : []),
        ...(item.linkedPancakeHtml
          ? [
              "• <b>On-chain (Pancake)</b>",
              item.linkedPancakeHtml,
            ]
          : []),
        "",
      );
    }
  }
  const pancakeBlock = buildPancakePlacementsDetailsHtml(d.pancake);
  if (pancakeBlock) parts.push(pancakeBlock);
  let out = parts.join("\n");
  if (!out.trim()) return "";
  if (out.length > TELEGRAM_DETAILS_MAX_CHARS) {
    out =
      out.slice(0, TELEGRAM_DETAILS_MAX_CHARS) +
      "\n\n<i>… (details truncated for Telegram length limit)</i>";
  }
  return out;
}

/** Telegram HTML: per-signal details only (may be empty). */
export function buildDailyReportDetailsHtml(): string {
  return buildDailyReportDetailsHtmlForData(buildDailyReportData());
}

export function buildDailyReportText(): string {
  const d = buildDailyReportData();
  if (!d.hasLogs) {
    return "📊 <b>Daily Report</b> (GMT+7)\nNo logs found yet.";
  }

  const header = buildDailyReportHeaderLinesHtml(d);
  const details = buildDailyReportDetailsHtmlForData(d);
  return [...header, details].filter(Boolean).join("\n");
}

function runDailyReportCli(): void {
  for (const line of buildDailyReportLines()) {
    console.log(line);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyReportCli();
}
