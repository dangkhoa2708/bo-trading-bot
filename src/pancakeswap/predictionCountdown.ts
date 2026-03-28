/**
 * PancakeSwap Prediction V2 (BNB) — same on-chain data the web UI uses for round timing.
 * @see https://developer.pancakeswap.finance/contracts/prediction/addresses
 * @see https://pancakeswap.finance/prediction?token=BNB
 */
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { escapeHtml } from "../logging/verify.js";
import { fmtGmt7WithZoneLabel } from "../time/utils.js";
import { PANCAKE_PREDICTION_BNB_PAGE_URL } from "./urls.js";

/** BNB Prediction on BSC (PancakeSwap docs). */
export const PANCAKE_PREDICTION_BNB_CONTRACT =
  "0x18B2A687610328590Bc8F2e5fEdDe3b582A49cdA" as const;

export { PANCAKE_PREDICTION_BNB_PAGE_URL };

const predictionAbi = parseAbi([
  "function currentEpoch() view returns (uint256)",
  "function rounds(uint256 epoch) view returns (uint256 epoch, uint256 startTimestamp, uint256 lockTimestamp, uint256 closeTimestamp, int256 lockPrice, int256 closePrice, uint256 lockOracleId, uint256 closeOracleId, uint256 totalAmount, uint256 bullAmount, uint256 bearAmount, uint256 rewardBaseCalAmount, uint256 rewardAmount, bool oracleCalled)",
]);

export type PredictionUiPhase = "betting" | "lock" | "ended";

export type PancakePredictionCountdownOk = {
  ok: true;
  epoch: bigint;
  phase: PredictionUiPhase;
  /** Seconds until lock (betting) or close (lock), or 0 if ended / indeterminate. */
  secondsRemaining: number;
  headline: string;
  startTimestamp: number;
  lockTimestamp: number;
  closeTimestamp: number;
  fetchedAtSec: number;
};

export type PancakePredictionCountdownErr = { ok: false; message: string };

export type PancakePredictionCountdown =
  | PancakePredictionCountdownOk
  | PancakePredictionCountdownErr;

/** Format seconds as `Xm Ys` (for Telegram). */
export function formatDurationParts(totalSec: number): string {
  if (totalSec <= 0) return "0s";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * Derive UI phase from round timestamps (chain seconds) and current time.
 * Matches contract `_bettable`: betting strictly between start and lock.
 */
export function phaseFromRoundWallClock(
  nowSec: number,
  startTimestamp: number,
  lockTimestamp: number,
  closeTimestamp: number,
): Pick<
  PancakePredictionCountdownOk,
  "phase" | "secondsRemaining" | "headline"
> {
  if (startTimestamp === 0) {
    return {
      phase: "ended",
      secondsRemaining: 0,
      headline: "Round not started on-chain yet.",
    };
  }
  if (nowSec < lockTimestamp) {
    return {
      phase: "betting",
      secondsRemaining: Math.max(0, lockTimestamp - nowSec),
      headline: "Betting open — countdown to lock",
    };
  }
  if (nowSec < closeTimestamp) {
    return {
      phase: "lock",
      secondsRemaining: Math.max(0, closeTimestamp - nowSec),
      headline: "Locked — countdown to close / result",
    };
  }
  return {
    phase: "ended",
    secondsRemaining: 0,
    headline:
      "Round past close — next round appears after operator `executeRound` on-chain",
  };
}

export async function fetchPancakePredictionBnbCountdown(
  rpcUrl: string,
): Promise<PancakePredictionCountdown> {
  try {
    const client = createPublicClient({
      chain: bsc,
      transport: http(rpcUrl, { timeout: 15_000 }),
    });

    const epoch = await client.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: predictionAbi,
      functionName: "currentEpoch",
    });

    const round = await client.readContract({
      address: PANCAKE_PREDICTION_BNB_CONTRACT,
      abi: predictionAbi,
      functionName: "rounds",
      args: [epoch],
    });

    const startTimestamp = Number(round[1]);
    const lockTimestamp = Number(round[2]);
    const closeTimestamp = Number(round[3]);

    const fetchedAtSec = Math.floor(Date.now() / 1000);
    const { phase, secondsRemaining, headline } = phaseFromRoundWallClock(
      fetchedAtSec,
      startTimestamp,
      lockTimestamp,
      closeTimestamp,
    );

    return {
      ok: true,
      epoch,
      phase,
      secondsRemaining,
      headline,
      startTimestamp,
      lockTimestamp,
      closeTimestamp,
      fetchedAtSec,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** One HTML line for embedding in the main signal alert (after Reason, before mini chart). */
export function formatPancakeCountdownSignalSnippetHtml(
  r: PancakePredictionCountdown,
): string {
  if (!r.ok) {
    const short = r.message.length > 160 ? `${r.message.slice(0, 157)}…` : r.message;
    return `⏱ <b>Pancake countdown</b>: <i>unavailable</i> — <code>${escapeHtml(short)}</code>`;
  }
  const ep = r.epoch.toString();
  if (r.phase === "ended") {
    return [
      `⏱ <b>Pancake BNB prediction</b> epoch <code>${escapeHtml(ep)}</code>`,
      `<i>${escapeHtml(r.headline)}</i>`,
    ].join(" — ");
  }
  const t = formatDurationParts(r.secondsRemaining);
  const target = r.phase === "betting" ? "lock" : "close";
  return `⏱ <b>Pancake BNB prediction</b> epoch <code>${escapeHtml(ep)}</code> — phase <code>${escapeHtml(r.phase)}</code> → ${escapeHtml(target)} in <code>${escapeHtml(t)}</code>`;
}

export function buildLiveCountdownTelegramHtml(
  r: PancakePredictionCountdown,
): string {
  if (!r.ok) {
    return [
      "⏱ <b>PancakeSwap BNB prediction</b>",
      "",
      `<i>Could not read contract:</i> <code>${escapeHtml(r.message)}</code>`,
      "",
      `• <a href="${escapeHtml(PANCAKE_PREDICTION_BNB_PAGE_URL)}">Open live page</a>`,
    ].join("\n");
  }

  const epochStr = r.epoch.toString();
  const countdown =
    r.phase === "ended"
      ? "—"
      : `<code>${escapeHtml(formatDurationParts(r.secondsRemaining))}</code>`;

  return [
    "⏱ <b>Live countdown</b> <i>(PancakeSwap BNB prediction)</i>",
    "",
    `<b>Epoch</b>: <code>${escapeHtml(epochStr)}</code>`,
    `<b>Phase</b>: <code>${escapeHtml(r.phase)}</code>`,
    `<b>${escapeHtml(r.headline)}</b>`,
    `<b>Remaining</b>: ${countdown}`,
    "",
    `<b>Lock</b> <i>(betting ends)</i>: <code>${escapeHtml(fmtGmt7WithZoneLabel(r.lockTimestamp * 1000))}</code>`,
    `<b>Close</b> <i>(round ends)</i>: <code>${escapeHtml(fmtGmt7WithZoneLabel(r.closeTimestamp * 1000))}</code>`,
    "",
    "<i>Source: on-chain</i> <code>PancakePredictionV2</code> <code>rounds(epoch)</code> — same schedule as the site.",
    "",
    `• <a href="${escapeHtml(PANCAKE_PREDICTION_BNB_PAGE_URL)}">PancakeSwap prediction</a>`,
  ].join("\n");
}
