import fs from "node:fs";
import path from "node:path";
import { formatEther } from "viem";
import { fetchBnbUsdtPrice } from "../binance/bnbPrice.js";
import type { TrackedPancakeBet } from "./betTracker.js";

const logDir = path.join(process.cwd(), "logs");
const LEDGER_FILE = path.join(logDir, "pancake-placements.jsonl");

export type PancakePlacementOutcome = "won" | "lost" | "draw" | "refund";

export type PancakePlacementRecord = {
  placementId: string;
  signalId: string;
  setup?: "Exhaustion" | "Mirror";
  /** Links to <code>predictions.jsonl</code> / <code>signals.jsonl</code>; omitted for <code>MANUAL_PLACEMENT</code>. */
  predictionId?: string;
  epoch: string;
  direction: "UP" | "DOWN";
  /** Integer wei strings (unsigned except profitWei may be negative). */
  betWei: string;
  claimWei: string;
  profitWei: string;
  /** Human-readable BNB decimals (matches contract math). */
  betAmountBnb: string;
  claimAmountBnb: string;
  profitBnb: string;
  outcome: PancakePlacementOutcome;
  betTxHash: string;
  claimTxHash?: string;
  /** ISO timestamp when settlement was recorded. */
  settledAt: string;
  /** Binance BNBUSDT at settle (null if fetch failed). */
  bnbUsdAtSettle: number | null;
  stakeUsdtApprox: number | null;
  claimUsdtApprox: number | null;
  profitUsdtApprox: number | null;
  /** Claim executed outside this bot (poller saw ledger claimed). */
  settledOffBot?: boolean;
};

function usdtFromBnbWei(wei: bigint, bnbUsd: number | null): number | null {
  if (bnbUsd === null) return null;
  const bnb = Number(formatEther(wei));
  if (!Number.isFinite(bnb)) return null;
  return bnb * bnbUsd;
}

export async function appendPancakePlacementSettlement(args: {
  row: TrackedPancakeBet;
  outcome: PancakePlacementOutcome;
  claimWei: bigint;
  claimTxHash?: string;
  settledOffBot?: boolean;
}): Promise<void> {
  try {
    const betWei = BigInt(args.row.valueWei);
    const profitWei = args.claimWei - betWei;
    const bnbUsd = await fetchBnbUsdtPrice();
    const rec: PancakePlacementRecord = {
      placementId: args.row.placementId,
      signalId: args.row.signalId,
      ...(args.row.setup !== undefined ? { setup: args.row.setup } : {}),
      ...(args.row.predictionId !== undefined
        ? { predictionId: args.row.predictionId }
        : {}),
      epoch: args.row.epoch,
      direction: args.row.direction,
      betWei: betWei.toString(),
      claimWei: args.claimWei.toString(),
      profitWei: profitWei.toString(),
      betAmountBnb: formatEther(betWei),
      claimAmountBnb: formatEther(args.claimWei),
      profitBnb: formatEther(profitWei),
      outcome: args.outcome,
      betTxHash: args.row.betTxHash,
      claimTxHash: args.claimTxHash,
      settledAt: new Date().toISOString(),
      bnbUsdAtSettle: bnbUsd,
      stakeUsdtApprox: usdtFromBnbWei(betWei, bnbUsd),
      claimUsdtApprox: usdtFromBnbWei(args.claimWei, bnbUsd),
      profitUsdtApprox: usdtFromBnbWei(profitWei, bnbUsd),
      settledOffBot: args.settledOffBot,
    };
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(LEDGER_FILE, `${JSON.stringify(rec)}\n`, "utf8");
  } catch (e) {
    console.error("[pancake-placement-ledger] append failed", e);
  }
}

export const PANCAKE_PLACEMENTS_FILE = LEDGER_FILE;
