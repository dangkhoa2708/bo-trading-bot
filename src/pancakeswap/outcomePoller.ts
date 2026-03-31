import { formatEther } from "viem";
import { config } from "../config.js";
import { escapeHtml } from "../logging/verify.js";
import {
  claimPancakePredictionEpochs,
  estimateClaimPayoutWei,
  formatPancakeClaimTelegramHtml,
  getPancakeRoundOutcome,
  readPancakeLedgerClaimed,
} from "./predictionBet.js";
import {
  listTrackedPancakeBets,
  markPancakeBetAwaitingClaim,
  removePancakeBet,
} from "./betTracker.js";
import { appendPancakePlacementSettlement } from "./placementLedger.js";
import { updateWalletBalanceCache } from "./walletBalanceCache.js";
import { getWalletForSetup, hasAnyConfiguredPancakeWallet } from "./setupWallets.js";

const POLL_MS = 30_000;

type SendTelegram = (
  text: string,
  options?: {
    parseMode?: "HTML" | "MarkdownV2";
    replyMarkup?: {
      inline_keyboard: Array<
        Array<{ text: string; url: string } | { text: string; callback_data: string }>
      >;
    };
  },
) => Promise<void>;

let started = false;

function claimReplyMarkup(placementId: string) {
  return {
    inline_keyboard: [
      [{ text: "Claim 🥞", callback_data: `pclaim:${placementId}` }],
    ],
  };
}

function buildOutcomeHtml(args: {
  headline: string;
  epoch: string;
  direction: string;
  valueBnb: string;
  detail?: string;
}): string {
  const lines = [
    args.headline,
    "",
    `<b>Epoch</b>: <code>${escapeHtml(args.epoch)}</code>`,
    `<b>Your side</b>: <code>${escapeHtml(args.direction)}</code>`,
    `<b>Stake</b>: <code>${escapeHtml(args.valueBnb)}</code> BNB`,
  ];
  if (args.detail) lines.push("", args.detail);
  return lines.join("\n");
}

async function pollTick(send: SendTelegram): Promise<void> {
  if (config.dryRun || !hasAnyConfiguredPancakeWallet()) return;

  // Refresh wallet balance cache for reports (best effort; non-blocking for outcomes).
  const exhaustionWallet = getWalletForSetup("Exhaustion");
  const mirrorWallet = getWalletForSetup("Mirror");
  const sharedWallet = getWalletForSetup(null);
  for (const wallet of [exhaustionWallet, mirrorWallet, sharedWallet]) {
    if (!wallet) continue;
    void updateWalletBalanceCache({
      rpcUrl: config.bscRpcUrl,
      privateKey: wallet.privateKey,
    });
  }

  const rows = listTrackedPancakeBets();
  for (const row of rows) {
    try {
      const epoch = BigInt(row.epoch);
      const wallet = getWalletForSetup(row.setup ?? null);
      if (wallet === null) {
        console.warn(
          "[pancake-outcome-poller] missing wallet for row",
          row.epoch,
          row.setup ?? "Shared",
        );
        continue;
      }
      if (row.phase === "awaiting_claim") {
        const claimed = await readPancakeLedgerClaimed({
          rpcUrl: config.bscRpcUrl,
          epoch,
          wallet: row.walletAddress,
        });
        if (claimed) {
          if (row.estimatedClaimWei) {
            const outcome = row.awaitingOutcome === "refund" ? "refund" : "won";
            await appendPancakePlacementSettlement({
              row,
              outcome,
              claimWei: BigInt(row.estimatedClaimWei),
              settledOffBot: true,
            });
          } else {
            console.warn(
              "[pancake-outcome-poller] ledger claimed but no estimate; skipping placement ledger",
              row.epoch,
            );
          }
          removePancakeBet(row.placementId);
        }
        continue;
      }

      const o = await getPancakeRoundOutcome({
        rpcUrl: config.bscRpcUrl,
        wallet: row.walletAddress,
        epoch,
      });

      const valueBnb = formatEther(BigInt(row.valueWei));

      switch (o.kind) {
        case "still_running":
        case "awaiting_oracle":
          break;
        case "won": {
          const est = await estimateClaimPayoutWei({
            rpcUrl: config.bscRpcUrl,
            epoch,
            wallet: row.walletAddress,
          });
          const res = await claimPancakePredictionEpochs({
            rpcUrl: config.bscRpcUrl,
            privateKey: wallet.privateKey,
            epochs: [epoch],
          });
          if (res.ok) {
            let claimWei = res.claimAmountWei;
            if (claimWei === 0n) claimWei = est;
            await appendPancakePlacementSettlement({
              row,
              outcome: "won",
              claimWei,
              claimTxHash: res.txHash,
            });
            removePancakeBet(row.placementId);
            await send(
              buildOutcomeHtml({
                headline: "🎉 <b>Pancake round finished — you won</b>",
                epoch: row.epoch,
                direction: row.direction,
                valueBnb,
                detail: "<b>Auto-claim</b>: submitted and confirmed ✅",
              }),
              { parseMode: "HTML" },
            );
            await send(
              formatPancakeClaimTelegramHtml(row.epoch, res, {
                placementId: row.placementId,
              }),
              { parseMode: "HTML" },
            );
          } else {
            // Fall back to manual claim button so you can retry.
            await send(
              buildOutcomeHtml({
                headline: "🎉 <b>Pancake round finished — you won</b>",
                epoch: row.epoch,
                direction: row.direction,
                valueBnb,
                detail:
                  "Auto-claim failed. Tap <b>Claim</b> to send <code>claim([epoch])</code> from your bot wallet.",
              }),
              { parseMode: "HTML", replyMarkup: claimReplyMarkup(row.placementId) },
            );
            markPancakeBetAwaitingClaim(row.placementId, {
              estimatedClaimWei: est.toString(),
              awaitingOutcome: "won",
            });
            await send(
              formatPancakeClaimTelegramHtml(row.epoch, res, {
                placementId: row.placementId,
              }),
              { parseMode: "HTML" },
            );
          }
          break;
        }
        case "refund_available": {
          const est = BigInt(row.valueWei);
          const res = await claimPancakePredictionEpochs({
            rpcUrl: config.bscRpcUrl,
            privateKey: wallet.privateKey,
            epochs: [epoch],
          });
          if (res.ok) {
            let claimWei = res.claimAmountWei;
            if (claimWei === 0n) claimWei = est;
            await appendPancakePlacementSettlement({
              row,
              outcome: "refund",
              claimWei,
              claimTxHash: res.txHash,
            });
            removePancakeBet(row.placementId);
            await send(
              buildOutcomeHtml({
                headline: "🔁 <b>Pancake round — refund available</b>",
                epoch: row.epoch,
                direction: row.direction,
                valueBnb,
                detail: "<b>Auto-claim</b>: refund submitted and confirmed ✅",
              }),
              { parseMode: "HTML" },
            );
            await send(
              formatPancakeClaimTelegramHtml(row.epoch, res, {
                placementId: row.placementId,
              }),
              { parseMode: "HTML" },
            );
          } else {
            await send(
              buildOutcomeHtml({
                headline: "🔁 <b>Pancake round — refund available</b>",
                epoch: row.epoch,
                direction: row.direction,
                valueBnb,
                detail:
                  "Auto-claim failed. Tap <b>Claim</b> to recover your stake.",
              }),
              { parseMode: "HTML", replyMarkup: claimReplyMarkup(row.placementId) },
            );
            markPancakeBetAwaitingClaim(row.placementId, {
              estimatedClaimWei: row.valueWei,
              awaitingOutcome: "refund",
            });
            await send(
              formatPancakeClaimTelegramHtml(row.epoch, res, {
                placementId: row.placementId,
              }),
              { parseMode: "HTML" },
            );
          }
          break;
        }
        case "lost": {
          await send(
            buildOutcomeHtml({
              headline: "📉 <b>Pancake round finished — you lost</b>",
              epoch: row.epoch,
              direction: row.direction,
              valueBnb,
            }),
            { parseMode: "HTML" },
          );
          await appendPancakePlacementSettlement({
            row,
            outcome: "lost",
            claimWei: 0n,
          });
          removePancakeBet(row.placementId);
          break;
        }
        case "draw": {
          await send(
            buildOutcomeHtml({
              headline: "⚖️ <b>Pancake round finished — draw (house)</b>",
              epoch: row.epoch,
              direction: row.direction,
              valueBnb,
              detail: "<i>Lock price equals close price — no winner payout.</i>",
            }),
            { parseMode: "HTML" },
          );
          await appendPancakePlacementSettlement({
            row,
            outcome: "draw",
            claimWei: 0n,
          });
          removePancakeBet(row.placementId);
          break;
        }
      }
    } catch (e) {
      console.error("[pancake-outcome-poller] tick row failed", row.epoch, e);
    }
  }
}

/**
 * Polls tracked epochs and notifies Telegram when a round settles (won / lost / draw / refund).
 * Claim is offered via inline button when applicable. No-op if dry-run or wallet missing.
 */
export function startPancakeOutcomePoller(send: SendTelegram): void {
  if (started) return;
  if (config.dryRun || !hasAnyConfiguredPancakeWallet()) return;
  started = true;
  void pollTick(send).catch((e) =>
    console.error("[pancake-outcome-poller] initial tick failed", e),
  );
  setInterval(() => {
    void pollTick(send).catch((e) =>
      console.error("[pancake-outcome-poller] tick failed", e),
    );
  }, POLL_MS);
}
