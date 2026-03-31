import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const logDir = path.join(process.cwd(), "logs");
export const WALLET_BALANCE_CACHE_FILE = path.join(logDir, "wallet-balance.json");

export type WalletBalanceCacheRow = {
  ts: string;
  walletAddress: `0x${string}`;
  balanceWei: string;
};

export async function updateWalletBalanceCache(args: {
  rpcUrl: string;
  privateKey: `0x${string}`;
}): Promise<void> {
  try {
    const account = privateKeyToAccount(args.privateKey);
    const transport = http(args.rpcUrl, { timeout: 60_000 });
    const publicClient = createPublicClient({ chain: bsc, transport });
    const bal = await publicClient.getBalance({ address: account.address });
    const row: WalletBalanceCacheRow = {
      ts: new Date().toISOString(),
      walletAddress: account.address,
      balanceWei: bal.toString(),
    };
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(WALLET_BALANCE_CACHE_FILE, JSON.stringify(row) + "\n", "utf8");
  } catch (e) {
    console.error("[wallet-balance-cache] update failed", e);
  }
}

