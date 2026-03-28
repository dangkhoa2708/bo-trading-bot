/** Bars waiting for optional human direction before next candle closes. */
const awaitingPick = new Set<number>();

/** Signal bar `openTime` (ms) → user's UP/DOWN. */
const picks = new Map<number, "UP" | "DOWN">();

/** Links pre-prediction bar → signal + prediction ids (for Pancake placement + reports). */
export type PlacementSignalLink = {
  signalId: string;
  predictionId: string;
};

const linkByOpenTime = new Map<number, PlacementSignalLink>();

/** Call when pre-prediction is sent (live). */
export function registerAwaitingHumanPick(
  fromOpenTime: number,
  link: PlacementSignalLink,
): void {
  awaitingPick.add(fromOpenTime);
  linkByOpenTime.set(fromOpenTime, link);
}

/** Telegram pick callback: resolve ids for on-chain placement logging. */
export function getPlacementLinkForOpenTime(
  fromOpenTime: number,
): PlacementSignalLink | undefined {
  return linkByOpenTime.get(fromOpenTime);
}

/** @deprecated Prefer {@link getPlacementLinkForOpenTime}. */
export function getSignalIdForOpenTime(fromOpenTime: number): string | undefined {
  return linkByOpenTime.get(fromOpenTime)?.signalId;
}

/** Callback: record choice for an active pre-prediction bar. */
export function recordHumanPick(
  fromOpenTime: number,
  dir: "UP" | "DOWN",
): boolean {
  if (!awaitingPick.has(fromOpenTime)) return false;
  picks.set(fromOpenTime, dir);
  return true;
}

/** At resolution: read pick, then clear state for this bar. */
export function consumeHumanPickForBar(
  fromOpenTime: number,
): "UP" | "DOWN" | undefined {
  const v = picks.get(fromOpenTime);
  picks.delete(fromOpenTime);
  awaitingPick.delete(fromOpenTime);
  linkByOpenTime.delete(fromOpenTime);
  return v;
}
