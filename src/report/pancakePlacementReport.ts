import fs from "node:fs";
import { formatEther } from "viem";
import { escapeHtml } from "../logging/verify.js";
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
    .map(
      (pl) =>
        `• 🥞 <code>${escapeHtml(pl.placementId.slice(0, 8))}…</code> ${escapeHtml(pl.outcome)} · P&amp;L <code>${escapeHtml(pl.profitBnb)}</code> BNB`,
    )
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
    "🥞 <b>Pancake placements</b> <i>(settled)</i>",
    `• Count: <code>${aggr.count}</code>`,
    `• Stake: <code>${escapeHtml(stakeBnb)}</code> BNB <i>(≈ ${escapeHtml(stakeU)} USDT)</i>`,
    `• Claimed: <code>${escapeHtml(claimBnb)}</code> BNB <i>(≈ ${escapeHtml(claimU)} USDT)</i>`,
    `• P&amp;L: <code>${escapeHtml(profitBnb)}</code> BNB <i>(≈ ${escapeHtml(profitU)} USDT)</i>`,
    usdtNote,
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
