import { config } from "../config.js";
import { normalizeBscPrivateKey } from "./predictionBet.js";
import type { SetupType } from "../types.js";

export type WalletSetup = "Exhaustion" | "Mirror";

export type RoutedWallet = {
  setup: WalletSetup | "Shared";
  privateKey: `0x${string}`;
};

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
  setup: WalletSetup | null | undefined,
): RoutedWallet | null {
  if (setup === "Exhaustion") {
    const pk =
      normalizeOptional(config.exhaustionBscWalletPrivateKey) ??
      normalizeOptional(config.bscWalletPrivateKey);
    return pk ? { setup, privateKey: pk } : null;
  }
  if (setup === "Mirror") {
    const pk =
      normalizeOptional(config.mirrorBscWalletPrivateKey) ??
      normalizeOptional(config.bscWalletPrivateKey);
    return pk ? { setup, privateKey: pk } : null;
  }
  const shared = normalizeOptional(config.bscWalletPrivateKey);
  return shared ? { setup: "Shared", privateKey: shared } : null;
}

export function hasAnyConfiguredPancakeWallet(): boolean {
  return (
    getWalletForSetup("Exhaustion") !== null ||
    getWalletForSetup("Mirror") !== null ||
    getWalletForSetup(null) !== null
  );
}
