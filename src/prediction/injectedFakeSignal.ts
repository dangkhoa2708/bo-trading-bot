/** Setup name in logs / reports for <code>/fakesignal</code> test runs. */
export const FAKE_SIGNAL_SETUP = "FakeSignal";

export type InjectedFakeSignalPayload = {
  signalId: string;
  predictionId: string;
  predicted: "UP" | "DOWN";
  fromOpenTime: number;
  fromSetup: string;
  baselineClose: number;
};

let queued: InjectedFakeSignalPayload | null = null;

/** Called from Telegram; main loop pulls on the next kline tick. */
export function enqueueFakeSignalForNextTick(
  payload: InjectedFakeSignalPayload,
): void {
  queued = payload;
}

export function pullFakeSignalIfQueued(): InjectedFakeSignalPayload | null {
  if (!queued) return null;
  const v = queued;
  queued = null;
  return v;
}
