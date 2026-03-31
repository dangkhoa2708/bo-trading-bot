import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const logDir = path.join(process.cwd(), "logs");
export const WALLET_BALANCE_CACHE_FILE = path.join(logDir, "wallet-balance.json");

export type WalletBalanceCacheRow = {
  key: "Exhaustion" | "Mirror" | "Shared";
  ts: string;
  walletAddress: `0x${string}`;
  balanceWei: string;
};

function readRows(): WalletBalanceCacheRow[] {
  try {
    if (!fs.existsSync(WALLET_BALANCE_CACHE_FILE)) return [];
    const raw = fs.readFileSync(WALLET_BALANCE_CACHE_FILE, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as WalletBalanceCacheRow[]) : [];
  } catch {
    return [];
  }
}

export async function updateWalletBalanceCache(args: {
  key: "Exhaustion" | "Mirror" | "Shared";
  rpcUrl: string;
  privateKey: `0x${string}`;
}): Promise<void> {
  try {
    const account = privateKeyToAccount(args.privateKey);
    const transport = http(args.rpcUrl, { timeout: 60_000 });
    const publicClient = createPublicClient({ chain: bsc, transport });
    const bal = await publicClient.getBalance({ address: account.address });
    const row: WalletBalanceCacheRow = {
      key: args.key,
      ts: new Date().toISOString(),
      walletAddress: account.address,
      balanceWei: bal.toString(),
    };
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const rows = readRows().filter((r) => r.key !== args.key);
    rows.push(row);
    fs.writeFileSync(WALLET_BALANCE_CACHE_FILE, JSON.stringify(rows) + "\n", "utf8");
  } catch (e) {
    console.error("[wallet-balance-cache] update failed", e);
  }
}

