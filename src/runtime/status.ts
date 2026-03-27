type RuntimeStatus = {
  startedAt: number;
  wsConnected: boolean;
  wsLastEventAt: number | null;
};

const state: RuntimeStatus = {
  startedAt: Date.now(),
  wsConnected: false,
  wsLastEventAt: null,
};

export function statusMarkWsConnected(connected: boolean): void {
  state.wsConnected = connected;
  state.wsLastEventAt = Date.now();
}

export function statusMarkWsEvent(): void {
  state.wsLastEventAt = Date.now();
}

function ageSec(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

export function getStatusSnapshot(): {
  uptimeSec: number;
  wsConnected: boolean;
  wsLastEventAgeSec: number | null;
} {
  const upSec = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
  const wsAge = ageSec(state.wsLastEventAt);
  return { uptimeSec: upSec, wsConnected: state.wsConnected, wsLastEventAgeSec: wsAge };
}

