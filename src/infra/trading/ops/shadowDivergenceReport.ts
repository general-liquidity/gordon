/**
 * Shadow vs realized PnL divergence report.
 *
 * Compares ghost fills (shadowMode) against closed trade outcomes
 * (tradeEvaluator). Used by /shadow-divergence and proactive ticks.
 */

import { getTradeOutcomes } from "../../domain/evals/tradeEvaluator.ts";
import {
  compareShadowVsReal,
  readShadowFills,
  summarizeShadowFills,
  type ShadowSummary,
  type ShadowVsRealComparison,
} from "./shadowMode.ts";

export interface ShadowDivergenceReport extends ShadowVsRealComparison {
  shadowFillCount: number;
  realOutcomeCount: number;
  sinceMs?: number;
}

function outcomesToShadowSummary(
  outcomes: Array<{ profitLoss: number; profitLossPercent: number; outcome: string }>,
): ShadowSummary {
  const winners = outcomes.filter((o) => o.outcome === "win");
  const losers = outcomes.filter((o) => o.outcome === "loss");
  const winnerPnls = winners.map((o) => o.profitLoss);
  const loserPnls = losers.map((o) => o.profitLoss);
  const fractions = outcomes.map((o) => o.profitLossPercent / 100);
  const totalPnl = outcomes.reduce((sum, o) => sum + o.profitLoss, 0);

  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const std = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
  };

  return {
    totalFills: outcomes.length,
    openFills: 0,
    closedFills: outcomes.length,
    totalPnl,
    winRate: outcomes.length > 0 ? winners.length / outcomes.length : null,
    winners: winners.length,
    losers: losers.length,
    avgWinnerPnl: winners.length > 0 ? mean(winnerPnls) : null,
    avgLoserPnl: losers.length > 0 ? mean(loserPnls) : null,
    pnlFractionMean: outcomes.length > 0 ? mean(fractions) : null,
    pnlFractionStd: outcomes.length > 0 ? std(fractions) : null,
  };
}

export function buildShadowDivergenceReport(opts?: {
  sinceMs?: number;
  sinceDate?: string;
  shadowPath?: string;
}): ShadowDivergenceReport {
  const shadowFills = readShadowFills(
    opts?.sinceMs !== undefined ? { sinceMs: opts.sinceMs } : {},
    opts?.shadowPath,
  );
  const shadow = summarizeShadowFills(shadowFills);

  const outcomes = getTradeOutcomes(
    opts?.sinceDate ? { sinceDate: opts.sinceDate } : undefined,
  );
  const real = outcomesToShadowSummary(outcomes);
  const comparison = compareShadowVsReal(shadow, real);

  return {
    ...comparison,
    shadowFillCount: shadowFills.length,
    realOutcomeCount: outcomes.length,
    sinceMs: opts?.sinceMs,
  };
}

export function formatShadowDivergenceReport(report: ShadowDivergenceReport): string {
  const { shadow, real, divergencePnl, divergencePnlFraction } = report;
  const divFrac =
    divergencePnlFraction !== null
      ? `${(divergencePnlFraction * 100).toFixed(2)}%`
      : "n/a";

  return [
    "◈ Shadow vs realized divergence",
    "",
    `Shadow fills: ${report.shadowFillCount} (${shadow.closedFills} closed, ${shadow.openFills} open)`,
    `Real outcomes: ${report.realOutcomeCount}`,
    "",
    `Shadow PnL: ${shadow.totalPnl.toFixed(2)} (win rate ${shadow.winRate !== null ? `${(shadow.winRate * 100).toFixed(1)}%` : "n/a"})`,
    `Real PnL: ${real.totalPnl.toFixed(2)} (win rate ${real.winRate !== null ? `${(real.winRate * 100).toFixed(1)}%` : "n/a"})`,
    "",
    `Divergence (shadow − real): ${divergencePnl.toFixed(2)} quote / ${divFrac} fraction`,
    divergencePnl > 0
      ? "→ Shadow outperformed: recommendations were better than what was executed."
      : divergencePnl < 0
        ? "→ Real outperformed shadow: executed trades beat ghost fills."
        : "→ No divergence.",
  ].join("\n");
}

export function shadowDivergenceToPayload(report: ShadowDivergenceReport): Record<string, unknown> {
  return {
    kind: "shadow.divergence_recorded",
    shadowFillCount: report.shadowFillCount,
    realOutcomeCount: report.realOutcomeCount,
    divergencePnl: report.divergencePnl,
    divergencePnlFraction: report.divergencePnlFraction,
    shadow: report.shadow,
    real: report.real,
    sinceMs: report.sinceMs,
  };
}