import fs from "node:fs";
import path from "node:path";
import { gmt7DateKey } from "../time/utils.js";

type SignalRow = {
  ts: string;
  signal: "UP" | "DOWN" | "NONE" | string;
  setup: string;
};

type PredictionRow = {
  ts: string;
  result: "RIGHT" | "WRONG" | string;
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

function runDailyReport(): void {
  const signalFile = path.join(process.cwd(), "logs", "signals.jsonl");
  const predictionFile = path.join(process.cwd(), "logs", "predictions.jsonl");
  if (!fs.existsSync(signalFile) && !fs.existsSync(predictionFile)) {
    console.log("[daily-report] no logs found in logs/");
    return;
  }
  const today = todayKeyGmt7();

  let todaySignals: SignalRow[] = [];
  if (fs.existsSync(signalFile)) {
    const raw = fs.readFileSync(signalFile, "utf8");
    const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    const rows = lines
      .map((line) => safeParse<SignalRow>(line))
      .filter((r): r is SignalRow => r !== null);
    todaySignals = rows.filter((r) => {
      const ms = Date.parse(r.ts);
      if (!Number.isFinite(ms)) return false;
      return gmt7DateKey(ms) === today;
    });
  }

  let todayPredictions: PredictionRow[] = [];
  if (fs.existsSync(predictionFile)) {
    const raw = fs.readFileSync(predictionFile, "utf8");
    const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
    const rows = lines
      .map((line) => safeParse<PredictionRow>(line))
      .filter((r): r is PredictionRow => r !== null);
    todayPredictions = rows.filter((r) => {
      const ms = Date.parse(r.ts);
      if (!Number.isFinite(ms)) return false;
      return gmt7DateKey(ms) === today;
    });
  }

  const up = todaySignals.filter((r) => r.signal === "UP").length;
  const down = todaySignals.filter((r) => r.signal === "DOWN").length;
  const bySetup = new Map<string, number>();
  for (const r of todaySignals) {
    bySetup.set(r.setup, (bySetup.get(r.setup) ?? 0) + 1);
  }
  const predRight = todayPredictions.filter((r) => r.result === "RIGHT").length;
  const predWrong = todayPredictions.filter((r) => r.result === "WRONG").length;

  const setupParts = [...bySetup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  console.log(`[daily-report] date_gmt7=${today}`);
  console.log(
    `[daily-report] signals total=${todaySignals.length} up=${up} down=${down} setups=${setupParts || "-"}`,
  );
  console.log(
    `[daily-report] predictions total=${todayPredictions.length} right=${predRight} wrong=${predWrong}`,
  );
}

runDailyReport();
