import fs from "node:fs";
import { formatEther } from "viem";
import { WALLET_BALANCE_CACHE_FILE, type WalletBalanceCacheRow } from "../pancakeswap/walletBalanceCache.js";
import { getWalletForSetup, walletDisplayName } from "../pancakeswap/setupWallets.js";
import { fmtGmt7 } from "../time/utils.js";

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type CachedWalletBalanceView = {
  key: "Exhaustion" | "Mirror" | "Shared";
  label: string;
  updatedAtGmt7: string;
  walletAddress: `0x${string}`;
  balanceBnb: string;
};

export function readCachedWalletBalances(): CachedWalletBalanceView[] {
  try {
    if (!fs.existsSync(WALLET_BALANCE_CACHE_FILE)) return [];
    const sharedWallet = getWalletForSetup(null);
    const raw = fs.readFileSync(WALLET_BALANCE_CACHE_FILE, "utf8").trim();
    if (!raw) return [];
    const rows = safeParse<WalletBalanceCacheRow[]>(raw);
    if (!rows || !Array.isArray(rows)) return [];
    const filteredRows =
      sharedWallet === null
        ? rows
        : rows.filter((row) => row.key === "Shared");
    return filteredRows.map((row) => {
      const ms = Date.parse(row.ts);
      const updatedAtGmt7 = Number.isFinite(ms) ? fmtGmt7(ms) : row.ts;
      return {
        key: row.key,
        label: walletDisplayName(row.key),
        updatedAtGmt7,
        walletAddress: row.walletAddress,
        balanceBnb: formatEther(BigInt(row.balanceWei)),
      };
    });
  } catch {
    return [];
  }
}

