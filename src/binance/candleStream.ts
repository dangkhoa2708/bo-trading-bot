import WebSocket from "ws";
import type { Candle } from "../types.js";
import { statusMarkWsConnected, statusMarkWsEvent } from "../runtime/status.js";

type KlineMsg = {
  e?: string;
  k?: {
    t: number;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
    x: boolean;
  };
};

function parseCandle(k: NonNullable<KlineMsg["k"]>): Candle {
  return {
    openTime: k.t,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
}

/** Binance spot kline stream; emits only on candle close (`x`). */
export function subscribeKline(
  symbol: string,
  interval: string,
  onClosedCandle: (c: Candle) => void,
): { close: () => void } {
  const s = symbol.toLowerCase();
  const url = `wss://stream.binance.com:9443/ws/${s}@kline_${interval}`;
  const retryMs = 5000;
  let ws: WebSocket | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let closing = false;

  function clearReconnectTimer(): void {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(reason: string): void {
    if (closing) return;
    if (reconnectTimer) return;
    statusMarkWsConnected(false);
    console.warn(`[ws] reconnect in ${retryMs}ms (${reason})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, retryMs);
  }

  function cleanupSocket(): void {
    if (!ws) return;
    try {
      ws.removeAllListeners();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    } catch {
      // ignore
    }
    ws = null;
  }

  function connect(): void {
    cleanupSocket();
    statusMarkWsConnected(false);
    statusMarkWsEvent();
    ws = new WebSocket(url);

    ws.on("open", () => {
      statusMarkWsConnected(true);
      statusMarkWsEvent();
    });

    ws.on("message", (data: WebSocket.RawData) => {
      statusMarkWsEvent();
      let msg: KlineMsg;
      try {
        msg = JSON.parse(String(data)) as KlineMsg;
      } catch {
        return;
      }
      if (msg.e !== "kline" || !msg.k || !msg.k.x) return;
      onClosedCandle(parseCandle(msg.k));
    });

    ws.on("close", () => {
      statusMarkWsConnected(false);
      statusMarkWsEvent();
      scheduleReconnect("close");
    });

    ws.on("error", (err) => {
      statusMarkWsEvent();
      console.error("[ws] error", err);
      scheduleReconnect("error");
    });
  }

  connect();

  return {
    close: () => {
      closing = true;
      clearReconnectTimer();
      statusMarkWsConnected(false);
      if (ws) {
        try {
          ws.removeAllListeners();
          ws.close();
          ws.terminate();
        } catch {
          // ignore
        }
      }
      ws = null;
    },
  };
}
