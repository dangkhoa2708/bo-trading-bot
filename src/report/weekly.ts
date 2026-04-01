import fs from "node:fs";
import path from "node:path";
import { formatEther } from "viem";
import { fmtGmt7 } from "../time/utils.js";
import {
  buildDualPredictionStats,
  scoreRowVsBot,
  scoreRowVsMyPick,
  type DualPredictionSection,
} from "./predictionStats.js";
import {
  buildPancakePlacementsDetailsHtml,
  buildPancakePlacementsShortSummaryHtmlLinesOrEmpty,
  filterPlacementsForSignalDetail,
  formatLinkedPlacementsDetailHtml,
  groupPlacementsBySetup,
  loadPancakePlacementsSince,
  type PancakePlacementAggregate,
} from "./pancakePlacementReport.js";
import { escapeHtml } from "../logging/verify.js";
import {
  filterPancakeAggregateExcludingFakeSignals,
  isFakeSignalPredictionRow,
  isFakeSignalSetup,
} from "./reportFilters.js";
import { readCachedWalletBalances } from "./walletBalance.js";

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
  predictionId?: string;
  time: string;
  openTime: string;
  close: number;
  signal: string;
  setup: string;
  reason: string;
  prediction: string;
  result: string;
  resultVsBot: string;
  resultVsMyPick: string;
  baselineClose: number | null;
  nextClose: number | null;
  linkedPancakeHtml: string;
  linkedPancakeText: string;
};

type WeeklyReportData = {
  hasLogs: boolean;
  windowLabel: string;
  signalTotal: number;
  up: number;
  down: number;
  setups: string;
  ignoredNoBetCount: number;
  placementResolvedCount: number;
  botPrediction: DualPredictionSection;
  myPicks: DualPredictionSection;
  details: DetailItem[];
  pancake: PancakePlacementAggregate;
};

function safeParse<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}

function parseRecentRows<T extends { ts: string }>(file: string, sinceMs: number): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const rows = lines
    .map((line) => safeParse<T>(line))
    .filter((r): r is T => r !== null);
  return rows.filter((r) => {
    const ms = Date.parse(r.ts);
    return Number.isFinite(ms) && ms >= sinceMs;
  });
}

function buildWeeklyReportData(): WeeklyReportData {
  const signalFile = path.join(process.cwd(), "logs", "signals.jsonl");
  const predictionFile = path.join(process.cwd(), "logs", "predictions.jsonl");
  const now = Date.now();
  const sinceMs = now - 7 * 24 * 60 * 60 * 1000;
  const windowLabel = `${fmtGmt7(sinceMs)} -> ${fmtGmt7(now)}`;
  const pancake = filterPancakeAggregateExcludingFakeSignals(
    loadPancakePlacementsSince(sinceMs),
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
      windowLabel,
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

  const signals = signalExists
    ? parseRecentRows<SignalRow>(signalFile, sinceMs)
    : [];
  const predictions = predExists
    ? parseRecentRows<PredictionRow>(predictionFile, sinceMs)
    : [];
  const reportSignals = signals.filter((r) => !isFakeSignalSetup(r.setup));
  const reportPredictions = predictions.filter((p) =>
    !isFakeSignalPredictionRow(p),
  );

  const up = reportSignals.filter((r) => r.signal === "UP").length;
  const down = reportSignals.filter((r) => r.signal === "DOWN").length;
  const bySetup = new Map<string, number>();
  for (const r of reportSignals)
    bySetup.set(r.setup, (bySetup.get(r.setup) ?? 0) + 1);
  const setups = [...bySetup.entries()]
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
    windowLabel,
    signalTotal: reportSignals.length,
    up,
    down,
    setups: setups || "-",
    ignoredNoBetCount,
    placementResolvedCount,
    botPrediction: dual.bot,
    myPicks: dual.myPicks,
    details,
    pancake,
  };
}

export function buildWeeklyReportLines(): string[] {
  const d = buildWeeklyReportData();
  if (!d.hasLogs) return ["[weekly-report] no logs found in logs/"];

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
    "================ WEEKLY REPORT (GMT+7) ===============",
    `Window      : ${d.windowLabel}`,
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
          "On-chain P&L (Pancake, settled in window)",
          `  Settled   : ${d.pancake.count}`,
          `  Stake BNB : ${formatEther(d.pancake.totalBetWei)}  (USDT ≈ at settle: ${d.pancake.sumStakeUsdt === null ? "—" : d.pancake.sumStakeUsdt.toFixed(2)})`,
          `  Claim BNB : ${formatEther(d.pancake.totalClaimWei)}  (USDT ≈ at settle: ${d.pancake.sumClaimUsdt === null ? "—" : d.pancake.sumClaimUsdt.toFixed(2)})`,
          `  Net P&L   : ${formatEther(d.pancake.totalProfitWei)}  (USDT ≈ at settle: ${d.pancake.sumProfitUsdt === null ? "—" : d.pancake.sumProfitUsdt.toFixed(2)})`,
        ]
      : [
          "",
          "On-chain P&L (Pancake, settled in window)",
          "  Net P&L   : — (no settled rows in pancake-placements.jsonl for this window)",
        ]),
    ...detailLines,
    "======================================================",
  ];
}

const TELEGRAM_DETAILS_MAX_CHARS = 3600;

/** Telegram HTML: summary only (no per-signal block). */
export function buildWeeklyReportSummaryHtml(): string {
  const d = buildWeeklyReportData();
  if (!d.hasLogs) {
    return "📈 <b>Weekly Report</b> (GMT+7)\nNo logs found yet.";
  }

  const header = buildWeeklyReportHeaderLinesHtml(d);
  if (d.details.length > 0 || d.pancake.count > 0) {
    header.push(
      "",
      `• <i>${d.details.length} per-signal row(s), ${d.pancake.count} Pancake placement(s) — tap <b>Show details</b> for breakdown.</i>`,
    );
  }
  return header.filter(Boolean).join("\n");
}

function buildWeeklyReportHeaderLinesHtml(d: WeeklyReportData): string[] {
  const balances = readCachedWalletBalances();
  const walletLines =
    balances.length > 0
      ? balances
          .sort((a, b) => a.key.localeCompare(b.key))
          .map(
            (bal) =>
              `• ${bal.label}: <code>${bal.balanceBnb}</code> BNB  <i>(wallet ${escapeHtml(bal.walletAddress.slice(0, 8))}…${escapeHtml(bal.walletAddress.slice(-4))}, updated ${bal.updatedAtGmt7})</i>`,
          )
      : ["• BNB: <code>—</code>  <i>(no wallet-balance cache yet)</i>"];
  const perSetupPnl = groupPlacementsBySetup(d.pancake.rows)
    .filter((g) => g.aggregate.count > 0)
    .map(
      (g) =>
        `• ${g.setup}: <code>${g.aggregate.count}</code> settled · net <code>${formatEther(g.aggregate.totalProfitWei)}</code> BNB`,
    );
  const base = [
    "📈 <b>Weekly Report</b> <i>(GMT+7)</i>",
    `🗓️ Window: <code>${d.windowLabel}</code>`,
    "",
    "💰 <b>Wallet</b>",
    ...walletLines,
    ...(perSetupPnl.length > 0 ? ["", "🪪 <b>Pancake by setup</b>", ...perSetupPnl] : []),
  ].filter((line) => line !== "");
  return [
    ...base,
    "",
    ...buildPancakePlacementsShortSummaryHtmlLinesOrEmpty(d.pancake, "weekly"),
  ];
}

function buildWeeklyReportDetailsHtmlForData(d: WeeklyReportData): string {
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
export function buildWeeklyReportDetailsHtml(): string {
  return buildWeeklyReportDetailsHtmlForData(buildWeeklyReportData());
}

export function buildWeeklyReportText(): string {
  const d = buildWeeklyReportData();
  if (!d.hasLogs) {
    return "📈 <b>Weekly Report</b> (GMT+7)\nNo logs found yet.";
  }

  const header = buildWeeklyReportHeaderLinesHtml(d);
  const details = buildWeeklyReportDetailsHtmlForData(d);
  return [...header, details].filter(Boolean).join("\n");
}

function runWeeklyReportCli(): void {
  for (const line of buildWeeklyReportLines()) {
    console.log(line);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWeeklyReportCli();
}
