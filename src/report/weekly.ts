import fs from "node:fs";
import path from "node:path";
import { fmtGmt7 } from "../time/utils.js";

type SignalRow = {
  signalId?: string;
  ts: string;
  openTime: number;
  price: number;
  signal: "UP" | "DOWN" | "NONE" | string;
  setup: string;
  reason: string;
};

type PredictionRow = {
  signalId?: string;
  ts: string;
  fromOpenTime: number;
  baselineClose: number;
  nextClose: number;
  expected: "UP" | "DOWN" | string;
  actual: "UP" | "DOWN" | "FLAT" | string;
  result: "RIGHT" | "WRONG" | string;
  setup?: string;
};

type PredStats = {
  total: number;
  right: number;
  wrong: number;
  winRatePct: number;
};

type DetailItem = {
  index: number;
  signalId: string;
  time: string;
  openTime: string;
  close: number;
  signal: string;
  setup: string;
  reason: string;
  prediction: string;
  result: string;
  baselineClose: number | null;
  nextClose: number | null;
};

type WeeklyReportData = {
  hasLogs: boolean;
  windowLabel: string;
  signalTotal: number;
  up: number;
  down: number;
  setups: string;
  predictionTotal: number;
  right: number;
  wrong: number;
  winRatePct: number;
  predictionBySetup: Record<"Momentum" | "Exhaustion" | "Mirror" | "Other", PredStats>;
  details: DetailItem[];
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

  if (!fs.existsSync(signalFile) && !fs.existsSync(predictionFile)) {
    return {
      hasLogs: false,
      windowLabel,
      signalTotal: 0,
      up: 0,
      down: 0,
      setups: "-",
      predictionTotal: 0,
      right: 0,
      wrong: 0,
      winRatePct: 0,
      predictionBySetup: {
        Momentum: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
        Exhaustion: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
        Mirror: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
        Other: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
      },
      details: [],
    };
  }

  const signals = parseRecentRows<SignalRow>(signalFile, sinceMs);
  const predictions = parseRecentRows<PredictionRow>(predictionFile, sinceMs);

  const up = signals.filter((r) => r.signal === "UP").length;
  const down = signals.filter((r) => r.signal === "DOWN").length;
  const bySetup = new Map<string, number>();
  for (const r of signals) bySetup.set(r.setup, (bySetup.get(r.setup) ?? 0) + 1);
  const predRight = predictions.filter((r) => r.result === "RIGHT").length;
  const predWrong = predictions.filter((r) => r.result === "WRONG").length;
  const winRatePct = predictions.length > 0 ? (predRight / predictions.length) * 100 : 0;
  const setups = [...bySetup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const predByFromOpen = new Map<number, PredictionRow>();
  const predBySignalId = new Map<string, PredictionRow>();
  for (const p of predictions) {
    predByFromOpen.set(p.fromOpenTime, p);
    if (p.signalId) predBySignalId.set(p.signalId, p);
  }

  const setupBySignalId = new Map<string, string>();
  for (const s of signals) {
    const sid = s.signalId ?? `${s.openTime}-${s.signal}-${s.setup}`;
    setupBySignalId.set(sid, s.setup);
  }

  const predictionBySetup: WeeklyReportData["predictionBySetup"] = {
    Momentum: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    Exhaustion: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    Mirror: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    Other: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
  };
  for (const p of predictions) {
    const setup =
      p.setup && p.setup.trim()
        ? p.setup
        : p.signalId
          ? (setupBySignalId.get(p.signalId) ?? "Other")
          : "Other";
    const bucket =
      setup === "Momentum" || setup === "Exhaustion" || setup === "Mirror"
        ? setup
        : "Other";
    const b = predictionBySetup[bucket];
    b.total++;
    if (p.result === "RIGHT") b.right++;
    else if (p.result === "WRONG") b.wrong++;
  }
  for (const key of Object.keys(predictionBySetup) as Array<
    keyof typeof predictionBySetup
  >) {
    const b = predictionBySetup[key];
    b.winRatePct = b.total > 0 ? (b.right / b.total) * 100 : 0;
  }

  const details: DetailItem[] = signals.map((s, idx) => {
    const sid = s.signalId ?? `${s.openTime}-${s.signal}-${s.setup}`;
    const p = predBySignalId.get(sid) ?? predByFromOpen.get(s.openTime);
    return {
      index: idx + 1,
      signalId: sid,
      time: fmtGmt7(Date.parse(s.ts)),
      openTime: fmtGmt7(s.openTime),
      close: s.price,
      signal: s.signal,
      setup: s.setup,
      reason: s.reason,
      prediction: p ? `${p.expected} -> ${p.actual}` : "PENDING",
      result: p ? p.result : "PENDING",
      baselineClose: p ? p.baselineClose : null,
      nextClose: p ? p.nextClose : null,
    };
  });

  return {
    hasLogs: true,
    windowLabel,
    signalTotal: signals.length,
    up,
    down,
    setups: setups || "-",
    predictionTotal: predictions.length,
    right: predRight,
    wrong: predWrong,
    winRatePct,
    predictionBySetup,
    details,
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
      detailLines.push(`  Result      : ${item.result}`);
      detailLines.push(
        `  Baseline/Next: ${
          item.baselineClose !== null && item.nextClose !== null
            ? `${item.baselineClose.toFixed(2)} -> ${item.nextClose.toFixed(2)}`
            : "PENDING"
        }`,
      );
      detailLines.push(`  Reason      : ${item.reason}`);
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
    "Predictions",
    `  Total     : ${d.predictionTotal}`,
    `  Right     : ${d.right}`,
    `  Wrong     : ${d.wrong}`,
    `  Win rate  : ${d.winRatePct.toFixed(1)}%`,
    "",
    "Predictions by setup",
    `  Momentum   : ${d.predictionBySetup.Momentum.total} (✅ ${d.predictionBySetup.Momentum.right} / ❌ ${d.predictionBySetup.Momentum.wrong}) ${d.predictionBySetup.Momentum.winRatePct.toFixed(1)}%`,
    `  Exhaustion : ${d.predictionBySetup.Exhaustion.total} (✅ ${d.predictionBySetup.Exhaustion.right} / ❌ ${d.predictionBySetup.Exhaustion.wrong}) ${d.predictionBySetup.Exhaustion.winRatePct.toFixed(1)}%`,
    `  Mirror     : ${d.predictionBySetup.Mirror.total} (✅ ${d.predictionBySetup.Mirror.right} / ❌ ${d.predictionBySetup.Mirror.wrong}) ${d.predictionBySetup.Mirror.winRatePct.toFixed(1)}%`,
    d.predictionBySetup.Other.total > 0
      ? `  Other      : ${d.predictionBySetup.Other.total} (✅ ${d.predictionBySetup.Other.right} / ❌ ${d.predictionBySetup.Other.wrong}) ${d.predictionBySetup.Other.winRatePct.toFixed(1)}%`
      : "  Other      : 0",
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
  if (d.details.length > 0) {
    header.push(
      "",
      `• <i>${d.details.length} per-signal row(s) — tap <b>Show details</b> below.</i>`,
    );
  }
  return header.filter(Boolean).join("\n");
}

function buildWeeklyReportHeaderLinesHtml(d: WeeklyReportData): string[] {
  return [
    "📈 <b>Weekly Report</b> <i>(GMT+7)</i>",
    `🗓️ Window: <code>${d.windowLabel}</code>`,
    "",
    "📡 <b>Signals</b>",
    `• Total: <code>${d.signalTotal}</code>`,
    `• UP / DOWN: <code>${d.up} / ${d.down}</code>`,
    `• Setups: <code>${d.setups}</code>`,
    "",
    "🎯 <b>Predictions</b>",
    `• Total: <code>${d.predictionTotal}</code>`,
    `• ✅ Right: <code>${d.right}</code>`,
    `• ❌ Wrong: <code>${d.wrong}</code>`,
    `• 🏆 Win rate: <code>${d.winRatePct.toFixed(1)}%</code>`,
    "",
    "🧩 <b>Predictions by setup</b>",
    `• Momentum: <code>${d.predictionBySetup.Momentum.total}</code> (✅ <code>${d.predictionBySetup.Momentum.right}</code> / ❌ <code>${d.predictionBySetup.Momentum.wrong}</code>) — <code>${d.predictionBySetup.Momentum.winRatePct.toFixed(1)}%</code>`,
    `• Exhaustion: <code>${d.predictionBySetup.Exhaustion.total}</code> (✅ <code>${d.predictionBySetup.Exhaustion.right}</code> / ❌ <code>${d.predictionBySetup.Exhaustion.wrong}</code>) — <code>${d.predictionBySetup.Exhaustion.winRatePct.toFixed(1)}%</code>`,
    `• Mirror: <code>${d.predictionBySetup.Mirror.total}</code> (✅ <code>${d.predictionBySetup.Mirror.right}</code> / ❌ <code>${d.predictionBySetup.Mirror.wrong}</code>) — <code>${d.predictionBySetup.Mirror.winRatePct.toFixed(1)}%</code>`,
    d.predictionBySetup.Other.total > 0
      ? `• Other: <code>${d.predictionBySetup.Other.total}</code> (✅ <code>${d.predictionBySetup.Other.right}</code> / ❌ <code>${d.predictionBySetup.Other.wrong}</code>) — <code>${d.predictionBySetup.Other.winRatePct.toFixed(1)}%</code>`
      : "",
  ];
}

function buildWeeklyReportDetailsHtmlForData(d: WeeklyReportData): string {
  if (!d.hasLogs || d.details.length === 0) return "";

  const detailText: string[] = ["", "🧾 <b>Details</b>"];
  for (const item of d.details) {
    detailText.push(
      `<b>Signal ${item.index}</b>`,
      `• SignalId: <code>${item.signalId}</code>`,
      `• Time: <code>${item.time}</code>`,
      `• OpenTime: <code>${item.openTime}</code>`,
      `• Close: <code>${item.close.toFixed(2)}</code>`,
      `• Signal: <code>${item.signal} (${item.setup})</code>`,
      `• Prediction: <code>${item.prediction}</code>`,
      `• Result: <b>${item.result}</b>`,
      `• Baseline/Next: <code>${
        item.baselineClose !== null && item.nextClose !== null
          ? `${item.baselineClose.toFixed(2)} -> ${item.nextClose.toFixed(2)}`
          : "PENDING"
      }</code>`,
      `• Reason: <i>${item.reason}</i>`,
      "",
    );
  }
  let out = detailText.join("\n");
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
