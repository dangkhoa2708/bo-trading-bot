import fs from "node:fs";
import path from "node:path";

const logDir = path.join(process.cwd(), "logs");

export type LogRow = {
  signalId: string;
  /** UUID shared with the matching row in <code>predictions.jsonl</code> when it resolves. */
  predictionId: string;
  ts: string;
  openTime: number;
  price: number;
  signal: string;
  setup: string;
  reason: string;
};

export type PredictionLogRow = {
  signalId: string;
  /** Same UUID as emitted on the sibling line in <code>signals.jsonl</code>. */
  predictionId: string;
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
  /**
   * <code>IGNORED</code> / <code>PLACEMENT</code>: current rows; daily reports still score next-candle vs bot/pick.
   * <code>RIGHT</code>/<code>WRONG</code>: older rows only (same scoring semantics).
   */
  result: "RIGHT" | "WRONG" | "IGNORED" | "PLACEMENT";
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
