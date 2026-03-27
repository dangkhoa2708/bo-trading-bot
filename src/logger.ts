import fs from "node:fs";
import path from "node:path";

const logDir = path.join(process.cwd(), "logs");

export type LogRow = {
  signalId: string;
  ts: string;
  openTime: number;
  price: number;
  signal: string;
  setup: string;
  reason: string;
};

export type PredictionLogRow = {
  signalId: string;
  ts: string;
  fromOpenTime: number;
  baselineClose: number;
  nextClose: number;
  /** Direction used to score `result` (human pick if set, else bot). */
  expected: "UP" | "DOWN";
  botExpected: "UP" | "DOWN";
  /** User's Telegram button choice; omitted or null if not set before resolve. */
  humanPick: "UP" | "DOWN" | null;
  actual: "UP" | "DOWN" | "FLAT";
  result: "RIGHT" | "WRONG";
  setup: string;
};

export function appendSignalLog(row: LogRow): void {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, "signals.jsonl");
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[logger] failed", e);
  }
}

export function appendPredictionLog(row: PredictionLogRow): void {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, "predictions.jsonl");
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (e) {
    console.error("[logger] failed", e);
  }
}
