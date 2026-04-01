import { config } from "../config.js";
import { normalizeBscPrivateKey } from "./predictionBet.js";
import type { SetupType } from "../types.js";

export type WalletSetup = "Exhaustion" | "Mirror";
export type WalletKey = WalletSetup | "Shared";

export type RoutedWallet = {
  setup: WalletKey;
  privateKey: `0x${string}`;
};

export function walletDisplayName(_key: WalletKey): string {
  return "Shared wallet";
}

function normalizeOptional(raw: string): `0x${string}` | null {
  return normalizeBscPrivateKey(raw);
}

export function setupFromResultSetup(
  setup: SetupType | string | undefined,
): WalletSetup | null {
  if (setup === "Exhaustion" || setup === "Mirror") return setup;
  return null;
}

export function getWalletForSetup(
  _setup: WalletSetup | null | undefined,
): RoutedWallet | null {
  const shared = normalizeOptional(config.bscWalletPrivateKey);
  return shared ? { setup: "Shared", privateKey: shared } : null;
}

export function hasAnyConfiguredPancakeWallet(): boolean {
  return getWalletForSetup(null) !== null;
}
