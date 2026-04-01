import fs from "node:fs";
import { formatEther } from "viem";
import { escapeHtml } from "../logging/verify.js";
import { walletDisplayName } from "../pancakeswap/setupWallets.js";
import { gmt7DateKey } from "../time/utils.js";
import {
  PANCAKE_PLACEMENTS_FILE,
  type PancakePlacementRecord,
} from "../pancakeswap/placementLedger.js";

export type PancakePlacementAggregate = {
  rows: PancakePlacementRecord[];
  count: number;
  totalBetWei: bigint;
  totalClaimWei: bigint;
  totalProfitWei: bigint;
  /** Sums of per-row USDT approx at settle; null if any row lacked price at settle. */
  sumStakeUsdt: number | null;
  sumClaimUsdt: number | null;
  sumProfitUsdt: number | null;
};

export function groupPlacementsBySetup(
  rows: PancakePlacementRecord[],
): Array<{
  setup: "Exhaustion" | "Mirror" | "Shared" | "Other";
  aggregate: PancakePlacementAggregate;
}> {
  const groups = new Map<string, PancakePlacementRecord[]>();
  for (const row of rows) {
    const key =
      row.setup === "Exhaustion" || row.setup === "Mirror"
        ? row.setup
        : row.signalId === "MANUAL_PLACEMENT"
          ? "Shared"
          : "Other";
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([setup, setupRows]) => ({
    setup: setup as "Exhaustion" | "Mirror" | "Shared" | "Other",
    aggregate: aggregatePancakePlacements(setupRows),
  }));
}

export function countPlacementOutcomes(rows: PancakePlacementRecord[]): {
  won: number;
  lost: number;
  other: number;
} {
  let won = 0;
  let lost = 0;
  let other = 0;
  for (const r of rows) {
    if (r.outcome === "won") won++;
    else if (r.outcome === "lost") lost++;
    else other++;
  }
  return { won, lost, other };
}

function readAllPlacements(): PancakePlacementRecord[] {
  if (!fs.existsSync(PANCAKE_PLACEMENTS_FILE)) return [];
  const raw = fs.readFileSync(PANCAKE_PLACEMENTS_FILE, "utf8");
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const out: PancakePlacementRecord[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as PancakePlacementRecord);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function aggregatePancakePlacements(
  rows: PancakePlacementRecord[],
): PancakePlacementAggregate {
  let totalBetWei = 0n;
  let totalClaimWei = 0n;
  let totalProfitWei = 0n;
  let sumStakeUsdt: number | null = 0;
  let sumClaimUsdt: number | null = 0;
  let sumProfitUsdt: number | null = 0;
  for (const r of rows) {
    totalBetWei += BigInt(r.betWei);
    totalClaimWei += BigInt(r.claimWei);
    totalProfitWei += BigInt(r.profitWei);
    if (r.stakeUsdtApprox === null) sumStakeUsdt = null;
    else if (sumStakeUsdt !== null) sumStakeUsdt += r.stakeUsdtApprox;
    if (r.claimUsdtApprox === null) sumClaimUsdt = null;
    else if (sumClaimUsdt !== null) sumClaimUsdt += r.claimUsdtApprox;
    if (r.profitUsdtApprox === null) sumProfitUsdt = null;
    else if (sumProfitUsdt !== null) sumProfitUsdt += r.profitUsdtApprox;
  }
  return {
    rows,
    count: rows.length,
    totalBetWei,
    totalClaimWei,
    totalProfitWei,
    sumStakeUsdt,
    sumClaimUsdt,
    sumProfitUsdt,
  };
}

export function loadPancakePlacementsForGmt7Day(dateKey: string): PancakePlacementAggregate {
  const rows = readAllPlacements().filter((r) => {
    const ms = Date.parse(r.settledAt);
    if (!Number.isFinite(ms)) return false;
    return gmt7DateKey(ms) === dateKey;
  });
  return aggregatePancakePlacements(rows);
}

export function loadPancakePlacementsSince(sinceMs: number): PancakePlacementAggregate {
  const rows = readAllPlacements().filter((r) => {
    const ms = Date.parse(r.settledAt);
    return Number.isFinite(ms) && ms >= sinceMs;
  });
  return aggregatePancakePlacements(rows);
}

/** Placements tied to a signal / prediction row for per-signal report details. */
export function filterPlacementsForSignalDetail(
  rows: PancakePlacementRecord[],
  args: { signalId: string; predictionId?: string },
): PancakePlacementRecord[] {
  return rows.filter((pl) => {
    const pid = pl.predictionId;
    if (args.predictionId) {
      if (pid) return pid === args.predictionId;
      return pl.signalId === args.signalId;
    }
    return pl.signalId === args.signalId && pid === undefined;
  });
}

export function formatLinkedPlacementsDetailHtml(
  placements: PancakePlacementRecord[],
): string {
  if (placements.length === 0) return "";
  return placements
    .map((pl) => {
      const walletPart = pl.walletAddress
        ? `<code>${escapeHtml(pl.walletAddress.slice(0, 8))}…${escapeHtml(pl.walletAddress.slice(-4))}</code>`
        : "<i>wallet unknown</i>";
      return `• 🥞 <code>${escapeHtml(pl.placementId.slice(0, 8))}…</code> ${escapeHtml(pl.outcome)} · ${escapeHtml(walletDisplayName("Shared"))} · ${walletPart} · P&amp;L <code>${escapeHtml(pl.profitBnb)}</code> BNB`;
    })
    .join("\n");
}

function fmtUsd(n: number | null): string {
  if (n === null) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}$${v.toFixed(2)}`;
}

/** Summary lines (HTML) for daily / weekly headers. */
export function buildPancakePlacementsSummaryHtmlLines(
  aggr: PancakePlacementAggregate,
): string[] {
  if (aggr.count === 0) return [];
  const stakeBnb = formatEther(aggr.totalBetWei);
  const claimBnb = formatEther(aggr.totalClaimWei);
  const profitBnb = formatEther(aggr.totalProfitWei);
  const stakeU = fmtUsd(aggr.sumStakeUsdt);
  const claimU = fmtUsd(aggr.sumClaimUsdt);
  const profitU = fmtUsd(aggr.sumProfitUsdt);
  const usdtNote =
    aggr.sumProfitUsdt === null
      ? "\n<i>USDT columns use Binance BNBUSDT at settle; some rows had no price — totals may show —.</i>"
      : "\n<i>USDT ≈ Binance BNBUSDT at each settlement time.</i>";
  return [
    "",
    "🥞 <b>On-chain P&amp;L</b> <i>(Pancake — settled rounds)</i>",
    `• Settled placements: <code>${aggr.count}</code>`,
    `• Stake (sum): <code>${escapeHtml(stakeBnb)}</code> BNB <i>(≈ ${escapeHtml(stakeU)} USDT)</i>`,
    `• Claimed (sum): <code>${escapeHtml(claimBnb)}</code> BNB <i>(≈ ${escapeHtml(claimU)} USDT)</i>`,
    `• <b>Net P&amp;L</b> (claimed − stake): <code>${escapeHtml(profitBnb)}</code> BNB <i>(≈ ${escapeHtml(profitU)} USDT)</i>`,
    usdtNote,
  ];
}

/**
 * Same as {@link buildPancakePlacementsSummaryHtmlLines}, but when there are no settled rows
 * still returns a short block so the report explicitly states that on-chain P&amp;L is zero / N/A for the window.
 */
export function buildPancakePlacementsSummaryHtmlLinesOrEmpty(
  aggr: PancakePlacementAggregate,
  window: "daily" | "weekly",
): string[] {
  const lines = buildPancakePlacementsSummaryHtmlLines(aggr);
  if (lines.length > 0) return lines;
  const scope =
    window === "daily"
      ? "this calendar day <i>(GMT+7)</i>"
      : "this 7-day window <i>(GMT+7)</i>";
  return [
    "",
    "🥞 <b>On-chain P&amp;L</b> <i>(Pancake — settled only)</i>",
    `• <b>Net P&amp;L</b>: — <i>(no settled placements in ${scope})</i>`,
    "• <i>Totals come from <code>logs/pancake-placements.jsonl</code> when the outcome poller records each settlement. Pending bets are not included.</i>",
  ];
}

/** Very short HTML summary for Telegram reports. */
export function buildPancakePlacementsShortSummaryHtmlLinesOrEmpty(
  aggr: PancakePlacementAggregate,
  window: "daily" | "weekly",
): string[] {
  const scope =
    window === "daily"
      ? "today <i>(GMT+7)</i>"
      : "last 7d <i>(GMT+7)</i>";
  const o = countPlacementOutcomes(aggr.rows);
  if (aggr.count === 0) {
    return [
      "🥞 <b>Placements</b>",
      `• W/L: <code>0/0</code>  (settled: <code>0</code>, ${scope})`,
      "🥞 <b>P&amp;L</b>",
      "• Net: <code>—</code> <i>(no settled rows)</i>",
    ];
  }
  const profitBnb = formatEther(aggr.totalProfitWei);
  const profitU = fmtUsd(aggr.sumProfitUsdt);
  const otherNote = o.other > 0 ? ` · other <code>${o.other}</code>` : "";
  return [
    "🥞 <b>Placements</b>",
    `• W/L: <code>${o.won}/${o.lost}</code>${otherNote}  (settled: <code>${aggr.count}</code>, ${scope})`,
    "🥞 <b>P&amp;L</b>",
    `• Net: <code>${escapeHtml(profitBnb)}</code> BNB <i>(≈ ${escapeHtml(profitU)} USDT)</i>`,
  ];
}

/** Detail block for expanded report (HTML). */
export function buildPancakePlacementsDetailsHtml(
  aggr: PancakePlacementAggregate,
): string {
  if (aggr.rows.length === 0) return "";
  const lines: string[] = [
    "",
    "🥞 <b>Pancake placement rows</b>",
    "<i>Amounts in BNB; USDT ≈ at settle (Binance BNBUSDT).</i>",
    "",
  ];
  for (const r of aggr.rows) {
    const pu =
      r.profitUsdtApprox === null ? "—" : `$${r.profitUsdtApprox.toFixed(2)}`;
    const off = r.settledOffBot ? " <i>(off-bot claim)</i>" : "";
    const predLine = r.predictionId
      ? `• predictionId: <code>${escapeHtml(r.predictionId)}</code>`
      : null;
    lines.push(
      `<b>${escapeHtml(r.placementId.slice(0, 8))}…</b>${off}`,
      `• signalId: <code>${escapeHtml(r.signalId)}</code> · epoch <code>${escapeHtml(r.epoch)}</code> · <code>${escapeHtml(r.direction)}</code>`,
      ...(predLine ? [predLine] : []),
      `• stake <code>${escapeHtml(r.betAmountBnb)}</code> BNB → claim <code>${escapeHtml(r.claimAmountBnb)}</code> BNB · P&amp;L <code>${escapeHtml(r.profitBnb)}</code> BNB <i>(≈ ${escapeHtml(pu)} USDT)</i>`,
      `• outcome: <code>${escapeHtml(r.outcome)}</code> · settled <code>${escapeHtml(r.settledAt)}</code>`,
      "",
    );
  }
  return lines.join("\n");
}
