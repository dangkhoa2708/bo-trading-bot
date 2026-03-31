import fs from "node:fs";
import path from "node:path";
import { formatEther } from "viem";
import type { BetDirection } from "./predictionBet.js";

const logDir = path.join(process.cwd(), "logs");
const STATE_FILE = path.join(logDir, "pancake-bets-pending.json");

export type AwaitingClaimMeta = {
  estimatedClaimWei: string;
  awaitingOutcome: "won" | "refund";
};

export type TrackedPancakeBet = {
  placementId: string;
  signalId: string;
  setup?: "Exhaustion" | "Mirror";
  /** Set when bet came from a signal pre-pick — matches <code>predictions.jsonl</code> / <code>signals.jsonl</code>. */
  predictionId?: string;
  /** Stake in BNB as a decimal string (e.g. <code>0.02</code>). */
  betAmountBnb: string;
  epoch: string;
  direction: BetDirection;
  betTxHash: string;
  valueWei: string;
  walletAddress: `0x${string}`;
  phase: "awaiting_result" | "awaiting_claim";
  estimatedClaimWei?: string;
  awaitingOutcome?: "won" | "refund";
};

function migrateRow(raw: unknown): TrackedPancakeBet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const epoch = o.epoch;
  const direction = o.direction;
  const betTxHash = o.betTxHash;
  const valueWei = o.valueWei;
  const walletAddress = o.walletAddress;
  const phase = o.phase;
  if (
    typeof epoch !== "string" ||
    (direction !== "UP" && direction !== "DOWN") ||
    typeof betTxHash !== "string" ||
    typeof valueWei !== "string" ||
    typeof walletAddress !== "string" ||
    (phase !== "awaiting_result" && phase !== "awaiting_claim")
  ) {
    return null;
  }
  const betWei = BigInt(valueWei);
  const placementId =
    typeof o.placementId === "string" ? o.placementId : `legacy-${epoch}`;
  const signalId =
    typeof o.signalId === "string" ? o.signalId : "unknown";
  const betAmountBnb =
    typeof o.betAmountBnb === "string"
      ? o.betAmountBnb
      : formatEther(betWei);
  const estimatedClaimWei =
    typeof o.estimatedClaimWei === "string"
      ? o.estimatedClaimWei
      : undefined;
  const awaitingOutcome =
    o.awaitingOutcome === "won" || o.awaitingOutcome === "refund"
      ? o.awaitingOutcome
      : undefined;
  const predictionId =
    typeof o.predictionId === "string" ? o.predictionId : undefined;
  const setup =
    o.setup === "Exhaustion" || o.setup === "Mirror" ? o.setup : undefined;
  return {
    placementId,
    signalId,
    ...(setup !== undefined ? { setup } : {}),
    predictionId,
    betAmountBnb,
    epoch,
    direction,
    betTxHash,
    valueWei,
    walletAddress: walletAddress as `0x${string}`,
    phase,
    estimatedClaimWei,
    awaitingOutcome,
  };
}

function readState(): TrackedPancakeBet[] {
  try {
    if (!fs.existsSync(STATE_FILE)) return [];
    const raw = fs.readFileSync(STATE_FILE, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => migrateRow(row))
      .filter((r): r is TrackedPancakeBet => r !== null);
  } catch (e) {
    console.error("[pancake-bet-tracker] read failed", e);
    return [];
  }
}

function writeState(rows: TrackedPancakeBet[]): void {
  try {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(rows)}\n`, "utf8");
  } catch (e) {
    console.error("[pancake-bet-tracker] write failed", e);
  }
}

export function registerPendingPancakeBet(row: {
  placementId: string;
  signalId: string;
  setup?: "Exhaustion" | "Mirror";
  predictionId?: string;
  betAmountBnb: string;
  epoch: bigint;
  direction: BetDirection;
  betTxHash: string;
  valueWei: bigint;
  walletAddress: `0x${string}`;
}): void {
  const epochStr = row.epoch.toString();
  const rows = readState();
  const hadSameWalletEpoch = rows.some(
    (r) => r.epoch === epochStr && r.walletAddress === row.walletAddress,
  );
  const next = rows.filter(
    (r) => !(r.epoch === epochStr && r.walletAddress === row.walletAddress),
  );
  if (hadSameWalletEpoch) {
    console.warn(
      "[pancake-bet-tracker] replacing pending row for epoch+wallet",
      epochStr,
      row.walletAddress,
      "(same wallet re-registered on same epoch — keeping latest tx)",
    );
  }
  next.push({
    placementId: row.placementId,
    signalId: row.signalId,
    ...(row.setup !== undefined ? { setup: row.setup } : {}),
    ...(row.predictionId !== undefined ? { predictionId: row.predictionId } : {}),
    betAmountBnb: row.betAmountBnb,
    epoch: epochStr,
    direction: row.direction,
    betTxHash: row.betTxHash,
    valueWei: row.valueWei.toString(),
    walletAddress: row.walletAddress,
    phase: "awaiting_result",
  });
  writeState(next);
}

export function listTrackedPancakeBets(): TrackedPancakeBet[] {
  return readState();
}

export function markPancakeBetAwaitingClaim(
  placementId: string,
  meta: AwaitingClaimMeta,
): void {
  const rows = readState();
  const i = rows.findIndex(
    (r) => r.placementId === placementId && r.phase === "awaiting_result",
  );
  if (i === -1) return;
  rows[i] = {
    ...rows[i]!,
    phase: "awaiting_claim",
    estimatedClaimWei: meta.estimatedClaimWei,
    awaitingOutcome: meta.awaitingOutcome,
  };
  writeState(rows);
}

export function removePancakeBet(placementId: string): void {
  writeState(readState().filter((r) => r.placementId !== placementId));
}

export function getPancakeBet(placementId: string): TrackedPancakeBet | undefined {
  return readState().find((r) => r.placementId === placementId);
}
