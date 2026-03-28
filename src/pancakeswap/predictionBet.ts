/**
 * Place BNB on PancakeSwap Prediction V2 (bull/bear) — same contract as the web UI.
 * Requires an EOA private key; smart-contract wallets cannot call `betBull`/`betBear`.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { bsc } from "viem/chains";
import {
  PANCAKE_PREDICTION_BNB_CONTRACT,
  isPancakeRoundBettableAt,
} from "./predictionCountdown.js";
import { escapeHtml } from "../logging/verify.js";

const betAbi = parseAbi([
  "function betBull(uint256 epoch) payable",
  "function betBear(uint256 epoch) payable",
  "function currentEpoch() view returns (uint256)",
  "function minBetAmount() view returns (uint256)",
  "function rounds(uint256 epoch) view returns (uint256 epoch, uint256 startTimestamp, uint256 lockTimestamp, uint256 closeTimestamp, int256 lockPrice, int256 closePrice, uint256 lockOracleId, uint256 closeOracleId, uint256 totalAmount, uint256 bullAmount, uint256 bearAmount, uint256 rewardBaseCalAmount, uint256 rewardAmount, bool oracleCalled)",
]);

/**
 * Poll until `currentEpoch` advances past `epochAtRequest` and that epoch is `_bettable`.
 * BNB rounds are ~5m; we poll gently to avoid hammering public RPC (2 reads per tick).
 */
const BETTABLE_POLL_MS = 10_000;
/** Slightly more than one full round + buffer if `executeRound` lags. */
const BETTABLE_MAX_WAIT_MS = 420_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNextEpochBettingWindow(
  publicClient: PublicClient,
  epochAtRequest: bigint,
  onWaitingForNextRound?: () => void | Promise<void>,
): Promise<{ epoch: bigint } | { error: string }> {
  const deadline = Date.now() + BETTABLE_MAX_WAIT_MS;
  let waitNotified = false;

  while (Date.now() < deadline) {
    const epoch = await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: betAbi,
      functionName: "currentEpoch",
    });

    const round = await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: betAbi,
      functionName: "rounds",
      args: [epoch],
    });

    const startTs = Number(round[1]);
    const lockTs = Number(round[2]);
    const nowSec = Math.floor(Date.now() / 1000);

    if (
      epoch > epochAtRequest &&
      isPancakeRoundBettableAt(nowSec, startTs, lockTs)
    ) {
      return { epoch };
    }

    if (!waitNotified && onWaitingForNextRound) {
      waitNotified = true;
      await onWaitingForNextRound();
    }

    await sleep(BETTABLE_POLL_MS);
  }

  return {
    error: `Timed out after ${BETTABLE_MAX_WAIT_MS / 1000}s waiting for a new epoch (${epochAtRequest.toString()}) to open for betting`,
  };
}

export type BetDirection = "UP" | "DOWN";

export type PancakeBetOk = {
  ok: true;
  txHash: `0x${string}`;
  epoch: bigint;
  /** `currentEpoch` at the moment the user requested a bet (before waiting). */
  epochAtRequest: bigint;
  direction: BetDirection;
  valueWei: bigint;
};

export type PancakeBetErr = { ok: false; message: string };

export type PancakeBetResult = PancakeBetOk | PancakeBetErr;

/** `0x` + 64 hex, or 64 hex without prefix. */
export function normalizeBscPrivateKey(raw: string): `0x${string}` | null {
  const s = raw.trim();
  if (!s) return null;
  const hex = s.startsWith("0x") ? s : `0x${s}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return hex as `0x${string}`;
}

export async function placePancakeBnbPredictionBet(args: {
  rpcUrl: string;
  privateKey: `0x${string}`;
  direction: BetDirection;
  valueWei: bigint;
  /** Fired once if we must wait for `currentEpoch` to advance and enter betting. */
  onWaitingForNextRound?: () => void | Promise<void>;
}): Promise<PancakeBetResult> {
  try {
    const account = privateKeyToAccount(args.privateKey);
    const transport = http(args.rpcUrl, { timeout: 60_000 });
    const publicClient = createPublicClient({ chain: bsc, transport });
    const walletClient = createWalletClient({
      account,
      chain: bsc,
      transport,
    });

    const minBet = await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: betAbi,
      functionName: "minBetAmount",
    });

    if (args.valueWei < minBet) {
      return {
        ok: false,
        message: `Bet ${formatEther(args.valueWei)} BNB is below contract minimum ${formatEther(minBet)} BNB`,
      };
    }

    const epochAtRequest = await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: betAbi,
      functionName: "currentEpoch",
    });

    const ready = await waitForNextEpochBettingWindow(
      publicClient,
      epochAtRequest,
      args.onWaitingForNextRound,
    );

    if ("error" in ready) {
      return { ok: false, message: ready.error };
    }

    const epoch = ready.epoch;

    const hash = await walletClient.writeContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: betAbi,
      functionName: args.direction === "UP" ? "betBull" : "betBear",
      args: [epoch],
      value: args.valueWei,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return {
      ok: true,
      txHash: hash,
      epoch,
      epochAtRequest,
      direction: args.direction,
      valueWei: args.valueWei,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

const BSCSCAN_TX = "https://bscscan.com/tx/";

export function formatPancakeBetFollowUpHtml(r: PancakeBetResult): string {
  if (!r.ok) {
    return [
      "❌ <b>Pancake bet failed</b>",
      "",
      `<i>Reason:</i> <code>${escapeHtml(r.message)}</code>`,
    ].join("\n");
  }
  const url = `${BSCSCAN_TX}${r.txHash}`;
  return [
    "✅ <b>Bet placed successfully</b>",
    "",
    "🥞 Your Pancake BNB prediction is on-chain.",
    `<i>At request, <code>currentEpoch</code> was <code>${escapeHtml(r.epochAtRequest.toString())}</code>; bet submitted on the next bettable epoch <code>${escapeHtml(r.epoch.toString())}</code> (current round is skipped).</i>`,
    `<b>Side</b>: <code>${escapeHtml(r.direction)}</code> <i>(bull / bear)</i>`,
    `<b>Epoch</b>: <code>${escapeHtml(r.epoch.toString())}</code>`,
    `<b>Amount</b>: <code>${escapeHtml(formatEther(r.valueWei))}</code> BNB`,
    `<b>Tx</b>: <a href="${escapeHtml(url)}">${escapeHtml(r.txHash)}</a>`,
  ].join("\n");
}
