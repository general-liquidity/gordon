/**
 * Marginal Contribution Diagnostic — answers the post's load-bearing
 * question: "Does this strategy add something my portfolio doesn't
 * already have?"
 *
 * Given an existing portfolio of strategy equity curves + a candidate
 * strategy, computes:
 *
 *   - Pairwise correlation between candidate and each existing strategy
 *   - Effective N before + after adding the candidate (Carhart formula)
 *   - Drawdown overlap analysis — % of days both candidate and
 *     aggregate portfolio are simultaneously in drawdown
 *   - Verdict: adds_diversification / marginal / redundant / worse
 *
 * The drawdown-overlap surface is the operator-meaningful "March / July"
 * check the post describes — if a candidate's drawdowns coincide with
 * the portfolio's existing drawdowns, it adds nothing even with low
 * mean correlation. Two strategies can have low correlation but still
 * draw down in the same regime crack.
 *
 * Verdict bands (operator-tunable):
 *   - adds_diversification: marginal effective-N gain ≥ 0.3 AND drawdown overlap < 0.5
 *   - marginal: marginal effective-N gain ≥ 0.1 OR drawdown overlap ≥ 0.5 but < 0.7
 *   - redundant: marginal effective-N gain < 0.1 AND drawdown overlap ≥ 0.7
 *   - worse: marginal effective-N gain is negative (correlation increased portfolio risk)
 */

import { computeEffectiveN } from "./effective-n.ts";
import { pearsonCorrelation } from "./helpers.ts";

export type MarginalContributionVerdict =
  | "adds_diversification"
  | "marginal"
  | "redundant"
  | "worse"
  | "insufficient_data";

export interface DrawdownOverlapAnalysis {
  totalDays: number;
  /** Days both candidate and aggregate portfolio were simultaneously in DD. */
  coDrawdownDays: number;
  /** Days candidate was in DD but portfolio was not. */
  candidateOnlyDrawdownDays: number;
  /** Days portfolio was in DD but candidate was not. */
  portfolioOnlyDrawdownDays: number;
  /**
   * Co-DD fraction: coDrawdownDays / max(coDrawdownDays + candidateOnlyDD,
   * coDrawdownDays + portfolioOnlyDD). High = candidate's DDs coincide
   * with portfolio's; low = they're in DD at different times (good).
   */
  overlapRatio: number;
  /** Maximum single-day drawdown of the candidate equity curve. */
  candidateMaxDrawdown: number;
  /** Maximum single-day drawdown of the aggregate portfolio. */
  portfolioMaxDrawdown: number;
}

export interface MarginalContribution {
  candidateId: string;
  /** Pairwise correlations between candidate and each existing strategy. */
  pairwiseCorrelations: Array<{ existingId: string; correlation: number }>;
  /** Mean absolute pairwise correlation with existing strategies. */
  meanAbsCorrelation: number;
  /** Effective N of existing portfolio (without candidate). */
  baseEffectiveN: number;
  /** Effective N of existing portfolio + candidate. */
  withCandidateEffectiveN: number;
  /** Marginal effective-N gain (with - without). Positive = adds diversification. */
  effectiveNDelta: number;
  /** Drawdown-overlap analysis. */
  drawdownOverlap: DrawdownOverlapAnalysis;
  verdict: MarginalContributionVerdict;
  summary: string;
}

export interface MarginalContributionOptions {
  /** Effective-N gain ≥ this counts as "adds diversification". Default 0.3. */
  diversificationThreshold?: number;
  /** Effective-N gain ≥ this counts as at least "marginal". Default 0.1. */
  marginalThreshold?: number;
  /** Drawdown overlap ≥ this is high (drags verdict toward redundant). Default 0.7. */
  highOverlapThreshold?: number;
  /** Drawdown overlap ≥ this is moderate. Default 0.5. */
  moderateOverlapThreshold?: number;
}

const DEFAULTS: Required<MarginalContributionOptions> = {
  diversificationThreshold: 0.3,
  marginalThreshold: 0.1,
  highOverlapThreshold: 0.7,
  moderateOverlapThreshold: 0.5,
};

/**
 * Convert an equity curve into period-over-period returns. Pure helper
 * — callers supplying returns directly can skip this.
 */
export function equityCurveToReturns(equity: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!;
    if (prev === 0 || !Number.isFinite(prev)) continue;
    returns.push((equity[i]! - prev) / prev);
  }
  return returns;
}

/**
 * Identify drawdown days from an equity curve. Returns a boolean array
 * indicating whether each timestep is below its running-max peak.
 */
function drawdownMask(equity: number[]): { mask: boolean[]; maxDD: number } {
  const mask: boolean[] = [];
  let peak = -Infinity;
  let maxDD = 0;
  for (const val of equity) {
    if (val > peak) peak = val;
    const inDd = val < peak;
    mask.push(inDd);
    if (peak > 0) {
      const dd = (peak - val) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return { mask, maxDD };
}

/**
 * Compute aggregate portfolio equity by equal-weighting the supplied
 * strategy equity curves. All curves must be equal length.
 */
function aggregatePortfolioEquity(portfolio: Record<string, number[]>): number[] | null {
  const ids = Object.keys(portfolio);
  if (ids.length === 0) return null;
  const T = portfolio[ids[0]!]!.length;
  for (const id of ids) {
    if (portfolio[id]!.length !== T) return null;
  }
  const aggregate: number[] = [];
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (const id of ids) sum += portfolio[id]![t]!;
    aggregate.push(sum / ids.length);
  }
  return aggregate;
}

/**
 * Compute marginal contribution of a candidate strategy to an existing
 * portfolio. Operates on EQUITY CURVES (not returns) — handles return
 * computation internally so drawdown analysis is straightforward.
 */
export function computeMarginalContribution(
  portfolio: Record<string, number[]>,
  candidateId: string,
  candidateEquity: number[],
  options: MarginalContributionOptions = {},
): MarginalContribution {
  const opts = { ...DEFAULTS, ...options };
  const existingIds = Object.keys(portfolio);
  const T = candidateEquity.length;

  const empty = (verdict: MarginalContributionVerdict, summary: string): MarginalContribution => ({
    candidateId,
    pairwiseCorrelations: [],
    meanAbsCorrelation: 0,
    baseEffectiveN: existingIds.length,
    withCandidateEffectiveN: existingIds.length,
    effectiveNDelta: 0,
    drawdownOverlap: {
      totalDays: 0,
      coDrawdownDays: 0,
      candidateOnlyDrawdownDays: 0,
      portfolioOnlyDrawdownDays: 0,
      overlapRatio: 0,
      candidateMaxDrawdown: 0,
      portfolioMaxDrawdown: 0,
    },
    verdict,
    summary,
  });

  if (T < 10) {
    return empty("insufficient_data", `Candidate equity curve too short (${T} < 10)`);
  }
  if (existingIds.length === 0) {
    return empty(
      "adds_diversification",
      `${candidateId}: empty portfolio — any candidate adds diversification`,
    );
  }
  for (const id of existingIds) {
    if (portfolio[id]!.length !== T) {
      return empty(
        "insufficient_data",
        `Length mismatch: portfolio['${id}'] has ${portfolio[id]!.length} but candidate has ${T}`,
      );
    }
  }

  const candidateReturns = equityCurveToReturns(candidateEquity);
  const existingReturns: Record<string, number[]> = {};
  for (const id of existingIds) {
    existingReturns[id] = equityCurveToReturns(portfolio[id]!);
  }

  // Pairwise correlations between candidate and existing strategies
  const pairwise: Array<{ existingId: string; correlation: number }> = [];
  let sumAbs = 0;
  let countAbs = 0;
  for (const id of existingIds) {
    const rho = pearsonCorrelation(candidateReturns, existingReturns[id]!);
    if (rho !== null) {
      pairwise.push({ existingId: id, correlation: parseFloat(rho.toFixed(4)) });
      sumAbs += Math.abs(rho);
      countAbs += 1;
    } else {
      pairwise.push({ existingId: id, correlation: 0 });
    }
  }
  const meanAbsCorrelation = countAbs > 0 ? sumAbs / countAbs : 0;

  // Effective N: before vs. after
  const baseEffN = computeEffectiveN(existingReturns).effectiveN;
  const withCandidate: Record<string, number[]> = {
    ...existingReturns,
    [candidateId]: candidateReturns,
  };
  const withCandidateEffN = computeEffectiveN(withCandidate).effectiveN;
  const effectiveNDelta = withCandidateEffN - baseEffN;

  // Drawdown overlap
  const portfolioEquity = aggregatePortfolioEquity(portfolio)!;
  const { mask: candidateDD, maxDD: candidateMaxDD } = drawdownMask(candidateEquity);
  const { mask: portfolioDD, maxDD: portfolioMaxDD } = drawdownMask(portfolioEquity);

  let coDays = 0;
  let candOnly = 0;
  let portOnly = 0;
  for (let i = 0; i < T; i++) {
    const c = candidateDD[i]!;
    const p = portfolioDD[i]!;
    if (c && p) coDays += 1;
    else if (c && !p) candOnly += 1;
    else if (!c && p) portOnly += 1;
  }
  const denom = Math.max(coDays + candOnly, coDays + portOnly);
  const overlapRatio = denom === 0 ? 0 : coDays / denom;

  // Verdict
  let verdict: MarginalContributionVerdict;
  if (effectiveNDelta < 0) {
    verdict = "worse";
  } else if (
    effectiveNDelta >= opts.diversificationThreshold &&
    overlapRatio < opts.moderateOverlapThreshold
  ) {
    verdict = "adds_diversification";
  } else if (
    effectiveNDelta < opts.marginalThreshold &&
    overlapRatio >= opts.highOverlapThreshold
  ) {
    verdict = "redundant";
  } else {
    verdict = "marginal";
  }

  const summary =
    `${candidateId}: ρ̄=${meanAbsCorrelation.toFixed(3)}, ` +
    `effective N ${baseEffN.toFixed(2)} → ${withCandidateEffN.toFixed(2)} (Δ ${effectiveNDelta >= 0 ? "+" : ""}${effectiveNDelta.toFixed(2)}), ` +
    `DD overlap ${(overlapRatio * 100).toFixed(0)}% → ${verdict}`;

  return {
    candidateId,
    pairwiseCorrelations: pairwise,
    meanAbsCorrelation: parseFloat(meanAbsCorrelation.toFixed(4)),
    baseEffectiveN: parseFloat(baseEffN.toFixed(4)),
    withCandidateEffectiveN: parseFloat(withCandidateEffN.toFixed(4)),
    effectiveNDelta: parseFloat(effectiveNDelta.toFixed(4)),
    drawdownOverlap: {
      totalDays: T,
      coDrawdownDays: coDays,
      candidateOnlyDrawdownDays: candOnly,
      portfolioOnlyDrawdownDays: portOnly,
      overlapRatio: parseFloat(overlapRatio.toFixed(4)),
      candidateMaxDrawdown: parseFloat(candidateMaxDD.toFixed(4)),
      portfolioMaxDrawdown: parseFloat(portfolioMaxDD.toFixed(4)),
    },
    verdict,
    summary,
  };
}
