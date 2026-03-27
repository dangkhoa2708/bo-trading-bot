import type { Candle } from "../types.js";

type KlineRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

/** Fetch recent closed klines (Binance spot). */
export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const u = new URL("https://api.binance.com/api/v3/klines");
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("interval", interval);
  u.searchParams.set("limit", String(limit));

  const res = await fetch(u);
  if (!res.ok) {
    throw new Error(`klines ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as KlineRow[];
  return data.map((row) => rowToCandle(row));
}

function rowToCandle(row: KlineRow): Candle {
  return {
    openTime: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  };
}

const KLINE_MAX_BATCH = 1000;

/**
 * Closed klines in [startMs, endMs] (ascending). Paginates (max 1000 per request).
 */
export async function fetchKlinesRange(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number,
): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const u = new URL("https://api.binance.com/api/v3/klines");
    u.searchParams.set("symbol", symbol.toUpperCase());
    u.searchParams.set("interval", interval);
    u.searchParams.set("limit", String(KLINE_MAX_BATCH));
    u.searchParams.set("startTime", String(cursor));
    u.searchParams.set("endTime", String(endMs));

    const res = await fetch(u);
    if (!res.ok) {
      throw new Error(`klines ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as KlineRow[];
    if (data.length === 0) break;
    for (const row of data) {
      out.push(rowToCandle(row));
    }
    const lastOpen = data[data.length - 1]![0];
    cursor = lastOpen + 1;
    if (data.length < KLINE_MAX_BATCH) break;
  }
  return out;
}
