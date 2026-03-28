/** Spot BNBUSDT from Binance public API (for placement P&L USDT columns in reports). */
export async function fetchBnbUsdtPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT",
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { price?: string };
    const n = Number(j.price);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
