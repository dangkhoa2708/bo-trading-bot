import { FAKE_SIGNAL_SETUP } from "../prediction/injectedFakeSignal.js";
import {
  aggregatePancakePlacements,
  type PancakePlacementAggregate,
} from "./pancakePlacementReport.js";

/** Telegram <code>/fakesignal</code> rows — excluded from daily/weekly performance reports. */
export function isFakeSignalSetup(setup: string): boolean {
  return setup === FAKE_SIGNAL_SETUP;
}

export function isFakeSignalPredictionRow(p: {
  setup?: string;
  signalId?: string;
}): boolean {
  if (p.setup === FAKE_SIGNAL_SETUP) return true;
  if (p.signalId?.endsWith(`-${FAKE_SIGNAL_SETUP}`)) return true;
  return false;
}

export function isFakeSignalPancakePlacement(signalId: string | undefined): boolean {
  if (!signalId) return false;
  return signalId.endsWith(`-${FAKE_SIGNAL_SETUP}`);
}

export function filterPancakeAggregateExcludingFakeSignals(
  agg: PancakePlacementAggregate,
): PancakePlacementAggregate {
  const rows = agg.rows.filter((r) => !isFakeSignalPancakePlacement(r.signalId));
  return aggregatePancakePlacements(rows);
}
