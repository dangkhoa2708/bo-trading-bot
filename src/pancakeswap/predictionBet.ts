/**
 * Place BNB on PancakeSwap Prediction V2 (bull/bear) — same contract as the web UI.
 * Requires an EOA private key; smart-contract wallets cannot call `betBull`/`betBear`.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  formatEther,
} from "viem";
import type { TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { bsc } from "viem/chains";
import {
  PANCAKE_PREDICTION_BNB_CONTRACT,
  isPancakeRoundBettableAt,
} from "./predictionCountdown.js";
import { escapeHtml } from "../logging/verify.js";

const pancakePredictionAbi = parseAbi([
  "function betBull(uint256 epoch) payable",
  "function betBear(uint256 epoch) payable",
  "function claim(uint256[] epochs)",
  "function currentEpoch() view returns (uint256)",
  "function minBetAmount() view returns (uint256)",
  "function bufferSeconds() view returns (uint256)",
  "function claimable(uint256 epoch, address user) view returns (bool)",
  "function refundable(uint256 epoch, address user) view returns (bool)",
  "function ledger(uint256 epoch, address user) view returns (uint8 position, uint256 amount, bool claimed)",
  "function rounds(uint256 epoch) view returns (uint256 epoch, uint256 startTimestamp, uint256 lockTimestamp, uint256 closeTimestamp, int256 lockPrice, int256 closePrice, uint256 lockOracleId, uint256 closeOracleId, uint256 totalAmount, uint256 bullAmount, uint256 bearAmount, uint256 rewardBaseCalAmount, uint256 rewardAmount, bool oracleCalled)",
  "event Claim(address indexed sender, uint256 indexed epoch, uint256 amount)",
]);

/** Match the contract: `_bettable` uses `block.timestamp`, not wall clock. */
async function latestChainTimestampSec(
  publicClient: PublicClient,
): Promise<number> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return Number(block.timestamp);
}

/**
 * `currentEpoch` + round read that is bettable at latest chain time, or null.
 * Call again immediately before `writeContract` so the epoch matches what the tx will see.
 */
async function readBettableEpochNow(
  publicClient: PublicClient,
): Promise<bigint | null> {
  const nowSec = await latestChainTimestampSec(publicClient);
  const epoch = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "currentEpoch",
  });
  const round = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "rounds",
    args: [epoch],
  });
  const startTs = Number(round[1]);
  const lockTs = Number(round[2]);
  if (!isPancakeRoundBettableAt(nowSec, startTs, lockTs)) return null;
  return epoch;
}

export type BetDirection = "UP" | "DOWN";

export type PancakeBetOk = {
  ok: true;
  txHash: `0x${string}`;
  epoch: bigint;
  direction: BetDirection;
  valueWei: bigint;
  walletAddress: `0x${string}`;
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
      abi: pancakePredictionAbi,
      functionName: "minBetAmount",
    });

    if (args.valueWei < minBet) {
      return {
        ok: false,
        message: `Bet ${formatEther(args.valueWei)} BNB is below contract minimum ${formatEther(minBet)} BNB`,
      };
    }

    const open = await readBettableEpochNow(publicClient);
    if (open === null) {
      const epoch = await publicClient.readContract({
        address: PANCAKE_PREDICTION_BNB_CONTRACT,
        abi: pancakePredictionAbi,
        functionName: "currentEpoch",
      });
      return {
        ok: false,
        message: `currentEpoch ${epoch.toString()} is not open for betting (locked or between rounds). Bet skipped — we do not wait or auto-enter the next round. Retry when Pancake shows betting open.`,
      };
    }

    const epochForTx = await readBettableEpochNow(publicClient);
    if (epochForTx === null) {
      return {
        ok: false,
        message:
          "Betting window closed before submit — try again when the round is open (no auto wait for next round).",
      };
    }

    const hash = await walletClient.writeContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: pancakePredictionAbi,
      functionName: args.direction === "UP" ? "betBull" : "betBear",
      args: [epochForTx],
      value: args.valueWei,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return {
      ok: true,
      txHash: hash,
      epoch: epochForTx,
      direction: args.direction,
      valueWei: args.valueWei,
      walletAddress: account.address,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

export type PancakeRoundOutcomeKind =
  | "still_running"
  | "awaiting_oracle"
  | "won"
  | "lost"
  | "draw"
  | "refund_available";

/**
 * On-chain outcome for a round the wallet bet on (matches {@link PancakePredictionV2}).
 */
export async function getPancakeRoundOutcome(args: {
  rpcUrl: string;
  wallet: `0x${string}`;
  epoch: bigint;
}): Promise<{ kind: PancakeRoundOutcomeKind }> {
  const transport = http(args.rpcUrl, { timeout: 60_000 });
  const publicClient = createPublicClient({ chain: bsc, transport });
  const nowSec = await latestChainTimestampSec(publicClient);
  const round = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "rounds",
    args: [args.epoch],
  });
  const startTs = Number(round[1]);
  const closeTs = Number(round[3]);
  const lockPrice = round[4];
  const closePrice = round[5];
  const oracleCalled = round[13];
  if (startTs === 0) return { kind: "still_running" };
  if (nowSec <= closeTs) return { kind: "still_running" };
  if (oracleCalled) {
    if (lockPrice === closePrice) return { kind: "draw" };
    const canClaim = await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: pancakePredictionAbi,
      functionName: "claimable",
      args: [args.epoch, args.wallet],
    });
    if (canClaim) return { kind: "won" };
    return { kind: "lost" };
  }
  const bufferSec = Number(
    await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: pancakePredictionAbi,
      functionName: "bufferSeconds",
    }),
  );
  if (nowSec <= closeTs + bufferSec) return { kind: "awaiting_oracle" };
  const ref = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "refundable",
    args: [args.epoch, args.wallet],
  });
  if (ref) return { kind: "refund_available" };
  return { kind: "awaiting_oracle" };
}

/**
 * Expected BNB payout (wei) if `claim([epoch])` succeeds now — matches contract branch logic.
 */
export async function estimateClaimPayoutWei(args: {
  rpcUrl: string;
  epoch: bigint;
  wallet: `0x${string}`;
}): Promise<bigint> {
  const transport = http(args.rpcUrl, { timeout: 60_000 });
  const publicClient = createPublicClient({ chain: bsc, transport });
  const round = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "rounds",
    args: [args.epoch],
  });
  const [, stakeAmount, claimed] = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "ledger",
    args: [args.epoch, args.wallet],
  });
  if (claimed || stakeAmount === 0n) return 0n;
  const startTs = Number(round[1]);
  const closeTs = Number(round[3]);
  const lockPrice = round[4];
  const closePrice = round[5];
  const rewardBaseCalAmount = round[11];
  const rewardAmount = round[12];
  const oracleCalled = round[13];
  if (startTs === 0) return 0n;
  if (!oracleCalled) {
    const nowSec = await latestChainTimestampSec(publicClient);
    const bufferSec = Number(
      await publicClient.readContract({
        address: PANCAKE_PREDICTION_BNB_CONTRACT,
        abi: pancakePredictionAbi,
        functionName: "bufferSeconds",
      }),
    );
    if (nowSec <= closeTs + bufferSec) return 0n;
    const ref = await publicClient.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: pancakePredictionAbi,
      functionName: "refundable",
      args: [args.epoch, args.wallet],
    });
    if (ref) return stakeAmount;
    return 0n;
  }
  if (lockPrice === closePrice) return 0n;
  const canClaim = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "claimable",
    args: [args.epoch, args.wallet],
  });
  if (!canClaim || rewardBaseCalAmount === 0n) return 0n;
  return (stakeAmount * rewardAmount) / rewardBaseCalAmount;
}

export function sumClaimPaidWeiFromReceipt(args: {
  receipt: TransactionReceipt;
  userAddress: `0x${string}`;
}): bigint {
  const want = args.userAddress.toLowerCase();
  const contractLc = PANCAKE_PREDICTION_BNB_CONTRACT.toLowerCase();
  let sum = 0n;
  for (const log of args.receipt.logs) {
    if (log.address.toLowerCase() !== contractLc) continue;
    try {
      const decoded = decodeEventLog({
        abi: pancakePredictionAbi,
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      if (decoded.eventName !== "Claim") continue;
      const a = decoded.args as {
        sender?: `0x${string}`;
        amount?: bigint;
      };
      if (!a.sender || a.amount === undefined) continue;
      if (a.sender.toLowerCase() !== want) continue;
      sum += a.amount;
    } catch {
      /* ignore */
    }
  }
  return sum;
}

export type PancakeClaimResult =
  | {
      ok: true;
      txHash: `0x${string}`;
      blockNumber: bigint;
      gasUsed: bigint;
      /** Re-read `ledger` after the receipt (all requested epochs). */
      ledgerClaimedVerified: boolean;
      /** Sum of <code>Claim</code> event <code>amount</code> for this wallet (0 if logs missing). */
      claimAmountWei: bigint;
    }
  | {
      ok: false;
      message: string;
      phase: "error" | "reverted";
      txHash?: `0x${string}`;
    };

export async function readPancakeLedgerClaimed(args: {
  rpcUrl: string;
  epoch: bigint;
  wallet: `0x${string}`;
}): Promise<boolean> {
  const transport = http(args.rpcUrl, { timeout: 60_000 });
  const publicClient = createPublicClient({ chain: bsc, transport });
  const [, , claimed] = await publicClient.readContract({
    address: PANCAKE_PREDICTION_BNB_CONTRACT,
    abi: pancakePredictionAbi,
    functionName: "ledger",
    args: [args.epoch, args.wallet],
  });
  return claimed;
}

export async function claimPancakePredictionEpochs(args: {
  rpcUrl: string;
  privateKey: `0x${string}`;
  epochs: bigint[];
}): Promise<PancakeClaimResult> {
  if (args.epochs.length === 0) {
    return { ok: false, message: "No epochs to claim", phase: "error" };
  }
  try {
    const account = privateKeyToAccount(args.privateKey);
    const transport = http(args.rpcUrl, { timeout: 60_000 });
    const publicClient = createPublicClient({ chain: bsc, transport });
    const walletClient = createWalletClient({
      account,
      chain: bsc,
      transport,
    });
    const hash = await walletClient.writeContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: pancakePredictionAbi,
      functionName: "claim",
      args: [args.epochs],
    });
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: `Submitted tx but could not confirm receipt: ${msg}`,
        phase: "error",
        txHash: hash,
      };
    }
    if (receipt.status === "reverted") {
      return {
        ok: false,
        message:
          "Transaction was mined but reverted (already claimed, not eligible, or contract rejected the claim).",
        phase: "reverted",
        txHash: hash,
      };
    }
    const wallet = account.address;
    let ledgerClaimedVerified = true;
    for (const ep of args.epochs) {
      const c = await readPancakeLedgerClaimed({
        rpcUrl: args.rpcUrl,
        epoch: ep,
        wallet,
      });
      if (!c) ledgerClaimedVerified = false;
    }
    const claimAmountWei = sumClaimPaidWeiFromReceipt({
      receipt,
      userAddress: wallet,
    });
    return {
      ok: true,
      txHash: hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      ledgerClaimedVerified,
      claimAmountWei,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg, phase: "error" };
  }
}

const BSCSCAN_TX = "https://bscscan.com/tx/";

export function formatPancakeClaimTelegramHtml(
  epochStr: string,
  res: PancakeClaimResult,
  extra?: {
    placementId?: string;
    setup?: "Exhaustion" | "Mirror";
    walletLabel?: string;
    walletAddress?: `0x${string}`;
  },
): string {
  const head = "📬 <b>Pancake claim — status</b>";
  const epochLine = `<b>Epoch</b>: <code>${escapeHtml(epochStr)}</code>`;
  const placementLine =
    extra?.placementId !== undefined
      ? `<b>Placement</b>: <code>${escapeHtml(extra.placementId)}</code>`
      : null;
  const setupLine =
    extra?.setup !== undefined
      ? `<b>Setup</b>: <code>${escapeHtml(extra.setup)}</code>`
      : null;
  const walletLabelLine =
    extra?.walletLabel !== undefined
      ? `<b>Wallet name</b>: <code>${escapeHtml(extra.walletLabel)}</code>`
      : null;
  const walletLine =
    extra?.walletAddress !== undefined
      ? `<b>Wallet</b>: <code>${escapeHtml(extra.walletAddress)}</code>`
      : null;
  if (res.ok) {
    const txUrl = `${BSCSCAN_TX}${res.txHash}`;
    const ledgerLine = res.ledgerClaimedVerified
      ? "✅ <b>Ledger</b>: epoch shows <b>claimed</b> on-chain."
      : "⚠️ <b>Ledger</b>: tx succeeded but <code>claimed</code> not visible yet — check BscScan or your wallet balance in a moment.";
    const paidBnb = formatEther(res.claimAmountWei);
    const claimLine =
      res.claimAmountWei > 0n
        ? `💰 <b>Claim payout</b> (from logs): <code>${escapeHtml(paidBnb)}</code> BNB`
        : "💰 <b>Claim payout</b>: <i>no Claim events decoded — check BscScan / wallet.</i>";
    return [
      head,
      "",
      "✅ <b>Transaction</b>: <b>succeeded</b> (mined)",
      ledgerLine,
      claimLine,
      "",
      ...([placementLine, setupLine, walletLabelLine, walletLine].filter(Boolean) as string[]),
      ...(placementLine || setupLine || walletLabelLine || walletLine ? [epochLine] : [epochLine]),
      `<b>Block</b>: <code>${escapeHtml(res.blockNumber.toString())}</code>`,
      `<b>Gas used</b>: <code>${escapeHtml(res.gasUsed.toString())}</code>`,
      `<b>Tx</b>: <a href="${escapeHtml(txUrl)}">${escapeHtml(res.txHash)}</a>`,
    ].join("\n");
  }
  if (res.phase === "reverted" && res.txHash) {
    const txUrl = `${BSCSCAN_TX}${res.txHash}`;
    return [
      head,
      "",
      "❌ <b>Transaction</b>: <b>reverted</b> (mined, execution failed)",
      "",
      ...([placementLine, setupLine, walletLabelLine, walletLine].filter(Boolean) as string[]),
      ...([placementLine, setupLine, walletLabelLine, walletLine].some(Boolean) ? [""] : []),
      epochLine,
      `<i>${escapeHtml(res.message)}</i>`,
      "",
      `<b>Tx</b>: <a href="${escapeHtml(txUrl)}">${escapeHtml(res.txHash)}</a>`,
    ].join("\n");
  }
  if (res.txHash) {
    const txUrl = `${BSCSCAN_TX}${res.txHash}`;
    return [
      head,
      "",
      "❌ <b>Claim</b>: incomplete",
      "",
      ...([placementLine, setupLine, walletLabelLine, walletLine].filter(Boolean) as string[]),
      ...([placementLine, setupLine, walletLabelLine, walletLine].some(Boolean) ? [""] : []),
      epochLine,
      `<i>${escapeHtml(res.message)}</i>`,
      "",
      `<b>Tx</b> (submitted): <a href="${escapeHtml(txUrl)}">${escapeHtml(res.txHash)}</a>`,
    ].join("\n");
  }
  return [
    head,
    "",
    "❌ <b>Claim</b>: no transaction broadcast",
    "",
    ...([placementLine, setupLine, walletLabelLine, walletLine].filter(Boolean) as string[]),
    ...([placementLine, setupLine, walletLabelLine, walletLine].some(Boolean) ? [""] : []),
    epochLine,
    `<i>${escapeHtml(res.message)}</i>`,
  ].join("\n");
}

export function formatPancakeBetFollowUpHtml(
  r: PancakeBetResult,
  extra?: {
    setup?: "Exhaustion" | "Mirror";
    walletLabel?: string;
    walletAddress?: `0x${string}`;
  },
): string {
  if (!r.ok) {
    return [
      "❌ <b>Pancake bet failed</b>",
      "",
      ...(extra?.setup ? [`<b>Setup</b>: <code>${escapeHtml(extra.setup)}</code>`] : []),
      ...(extra?.walletLabel
        ? [`<b>Wallet name</b>: <code>${escapeHtml(extra.walletLabel)}</code>`]
        : []),
      ...(extra?.walletAddress
        ? [`<b>Wallet</b>: <code>${escapeHtml(extra.walletAddress)}</code>`]
        : []),
      ...(extra?.setup || extra?.walletLabel || extra?.walletAddress ? [""] : []),
      `<i>Reason:</i> <code>${escapeHtml(r.message)}</code>`,
    ].join("\n");
  }
  const url = `${BSCSCAN_TX}${r.txHash}`;
  return [
    "✅ <b>Bet placed successfully</b>",
    "",
    "🥞 Your Pancake BNB prediction is on-chain.",
    ...(extra?.setup ? [`<b>Setup</b>: <code>${escapeHtml(extra.setup)}</code>`] : []),
    ...(extra?.walletLabel
      ? [`<b>Wallet name</b>: <code>${escapeHtml(extra.walletLabel)}</code>`]
      : []),
    ...(extra?.walletAddress
      ? [`<b>Wallet</b>: <code>${escapeHtml(extra.walletAddress)}</code>`]
      : []),
    `<i>Placed on live <code>currentEpoch</code> <code>${escapeHtml(r.epoch.toString())}</code> (open betting window at chain time; re-checked before submit).</i>`,
    `<b>Side</b>: <code>${escapeHtml(r.direction)}</code> <i>(bull / bear)</i>`,
    `<b>Epoch</b>: <code>${escapeHtml(r.epoch.toString())}</code>`,
    `<b>Amount</b>: <code>${escapeHtml(formatEther(r.valueWei))}</code> BNB`,
    `<b>Tx</b>: <a href="${escapeHtml(url)}">${escapeHtml(r.txHash)}</a>`,
  ].join("\n");
}
