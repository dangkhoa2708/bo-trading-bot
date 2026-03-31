import { randomUUID } from "node:crypto";
import { formatEther } from "viem";
import { config } from "../config.js";
import {
  formatPancakeBetFollowUpHtml,
  normalizeBscPrivateKey,
  placePancakeBnbPredictionBet,
} from "./predictionBet.js";
import { effectivePancakeBetWei } from "./betSizing.js";
import { registerPendingPancakeBet } from "./betTracker.js";

export type AutoPlacementResult =
  | { outcome: "not_configured" }
  | { outcome: "dryrun"; plainText: string }
  | { outcome: "result"; html: string };

/**
 * Place a Pancake Prediction bet automatically and register it for the outcome poller + reports.
 * Intended for auto-entry flows (e.g. Exhaustion-only mode).
 */
export async function autoPlacePancakeBetForSignal(args: {
  signalId: string;
  predictionId: string;
  direction: "UP" | "DOWN";
}): Promise<AutoPlacementResult> {
  const pk = normalizeBscPrivateKey(config.bscWalletPrivateKey);
  const betWei = effectivePancakeBetWei(
    config.pancakePredictionBetWei,
    args.direction,
  );
  if (pk === null || betWei === 0n) return { outcome: "not_configured" };
  if (config.dryRun) {
    return {
      outcome: "dryrun",
      plainText: `[dry-run] Would auto-place Pancake prediction ${args.direction} for ${formatEther(betWei)} BNB (no tx)`,
    };
  }
  try {
    const betResult = await placePancakeBnbPredictionBet({
      rpcUrl: config.bscRpcUrl,
      privateKey: pk,
      direction: args.direction,
      valueWei: betWei,
    });
    if (betResult.ok) {
      const placementId = randomUUID();
      registerPendingPancakeBet({
        placementId,
        signalId: args.signalId,
        predictionId: args.predictionId,
        betAmountBnb: formatEther(betWei),
        epoch: betResult.epoch,
        direction: betResult.direction,
        betTxHash: betResult.txHash,
        valueWei: betResult.valueWei,
        walletAddress: betResult.walletAddress,
      });
    }
    return { outcome: "result", html: formatPancakeBetFollowUpHtml(betResult) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      outcome: "result",
      html: formatPancakeBetFollowUpHtml({ ok: false, message: msg }),
    };
  }
}

