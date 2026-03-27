/** Bars waiting for optional human direction before next candle closes. */
const awaitingPick = new Set<number>();

/** Signal bar `openTime` (ms) → user's UP/DOWN. */
const picks = new Map<number, "UP" | "DOWN">();

/** Call when pre-prediction is sent (live). */
export function registerAwaitingHumanPick(fromOpenTime: number): void {
  awaitingPick.add(fromOpenTime);
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
  return v;
}
