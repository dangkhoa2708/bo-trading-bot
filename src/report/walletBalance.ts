import fs from "node:fs";
import { formatEther } from "viem";
import { WALLET_BALANCE_CACHE_FILE, type WalletBalanceCacheRow } from "../pancakeswap/walletBalanceCache.js";
import { fmtGmt7 } from "../time/utils.js";

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function readCachedWalletBalance(): {
  updatedAtGmt7: string;
  walletAddress: `0x${string}`;
  balanceBnb: string;
} | null {
  try {
    if (!fs.existsSync(WALLET_BALANCE_CACHE_FILE)) return null;
    const raw = fs.readFileSync(WALLET_BALANCE_CACHE_FILE, "utf8").trim();
    if (!raw) return null;
    const row = safeParse<WalletBalanceCacheRow>(raw);
    if (!row) return null;
    const ms = Date.parse(row.ts);
    const updatedAtGmt7 = Number.isFinite(ms) ? fmtGmt7(ms) : row.ts;
    return {
      updatedAtGmt7,
      walletAddress: row.walletAddress,
      balanceBnb: formatEther(BigInt(row.balanceWei)),
    };
  } catch {
    return null;
  }
}

