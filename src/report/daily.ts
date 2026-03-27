import fs from "node:fs";
import path from "node:path";
import { fmtGmt7, gmt7DateKey } from "../time/utils.js";

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

type DailyReportData = {
  hasLogs: boolean;
  date: string;
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
  if (!fs.existsSync(signalFile) && !fs.existsSync(predictionFile)) {
    return {
      hasLogs: false,
      date: today,
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

  const todaySignals = parseTodayRows<SignalRow>(signalFile, today);
  const todayPredictions = parseTodayRows<PredictionRow>(predictionFile, today);

  const up = todaySignals.filter((r) => r.signal === "UP").length;
  const down = todaySignals.filter((r) => r.signal === "DOWN").length;
  const bySetup = new Map<string, number>();
  for (const r of todaySignals) {
    bySetup.set(r.setup, (bySetup.get(r.setup) ?? 0) + 1);
  }
  const predRight = todayPredictions.filter((r) => r.result === "RIGHT").length;
  const predWrong = todayPredictions.filter((r) => r.result === "WRONG").length;
  const winRatePct =
    todayPredictions.length > 0
      ? (predRight / todayPredictions.length) * 100
      : 0;

  const setupParts = [...bySetup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const predByFromOpen = new Map<number, PredictionRow>();
  const predBySignalId = new Map<string, PredictionRow>();
  for (const p of todayPredictions) {
    predByFromOpen.set(p.fromOpenTime, p);
    if (p.signalId) predBySignalId.set(p.signalId, p);
  }

  const setupBySignalId = new Map<string, string>();
  for (const s of todaySignals) {
    const sid = s.signalId ?? `${s.openTime}-${s.signal}-${s.setup}`;
    setupBySignalId.set(sid, s.setup);
  }

  const predictionBySetup: DailyReportData["predictionBySetup"] = {
    Momentum: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    Exhaustion: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    Mirror: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
    Other: { total: 0, right: 0, wrong: 0, winRatePct: 0 },
  };
  for (const p of todayPredictions) {
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

  const details: DetailItem[] = todaySignals.map((s, idx) => {
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
    date: today,
    signalTotal: todaySignals.length,
    up,
    down,
    setups: setupParts || "-",
    predictionTotal: todayPredictions.length,
    right: predRight,
    wrong: predWrong,
    winRatePct,
    predictionBySetup,
    details,
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
    "================ DAILY REPORT (GMT+7) ================",
    `Date        : ${d.date}`,
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

export function buildDailyReportText(): string {
  const d = buildDailyReportData();
  if (!d.hasLogs) {
    return "📊 <b>Daily Report</b> (GMT+7)\nNo logs found yet.";
  }

  const header = [
    "📊 <b>Daily Report</b> <i>(GMT+7)</i>",
    `🗓️ Date: <code>${d.date}</code>`,
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

  const detailText: string[] = [];
  if (d.details.length > 0) {
    detailText.push("", "🧾 <b>Details</b>");
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
  }

  return [...header, ...detailText].join("\n");
}

function runDailyReportCli(): void {
  for (const line of buildDailyReportLines()) {
    console.log(line);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDailyReportCli();
}
