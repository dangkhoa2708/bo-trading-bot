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
  return data.map((row) => ({
    openTime: row[0],
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }));
}
