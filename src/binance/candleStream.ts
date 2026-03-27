import WebSocket from "ws";
import type { Candle } from "../types.js";

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
  const ws = new WebSocket(url);

  ws.on("message", (data: WebSocket.RawData) => {
    let msg: KlineMsg;
    try {
      msg = JSON.parse(String(data)) as KlineMsg;
    } catch {
      return;
    }
    if (msg.e !== "kline" || !msg.k || !msg.k.x) return;
    onClosedCandle(parseCandle(msg.k));
  });

  ws.on("error", (err) => {
    console.error("[ws] error", err);
  });

  return {
    close: () => {
      ws.close();
    },
  };
}
