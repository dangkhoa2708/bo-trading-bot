import fs from "node:fs";
import { listTrackedPancakeBets } from "./betTracker.js";
import { PANCAKE_PLACEMENTS_FILE } from "./placementLedger.js";

/**
 * Whether a Pancake bet was registered for this prediction (pending tracker or settled ledger).
 * Checked at candle resolution; a tap in flight may rarely miss until the next read.
 */
export function hasRecordedPancakeBetForPrediction(
  predictionId: string,
  signalId: string,
): boolean {
  for (const r of listTrackedPancakeBets()) {
    if (r.predictionId === predictionId) return true;
  }
  if (!fs.existsSync(PANCAKE_PLACEMENTS_FILE)) return false;
  const raw = fs.readFileSync(PANCAKE_PLACEMENTS_FILE, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as { predictionId?: string; signalId?: string };
      if (o.predictionId === predictionId) return true;
      if (o.signalId === signalId && o.predictionId === undefined) return true;
    } catch {
      /* skip line */
    }
  }
  return false;
}
