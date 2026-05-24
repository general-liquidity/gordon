/**
 * Hidden Beta Verifier — "you think you're neutral but you're not."
 *
 * Premise (algo trader 2026, dirty-carry video): vol-targeting + dollar-
 * neutrality does NOT guarantee beta-neutrality. A portfolio constructed
 * to be "market neutral" can still have massive residual exposure to
 * BTC, large-cap alts, SPY, or any other factor. The carry alpha is
 * then eaten by directional drift on the hidden factor.
 *
 * This primitive runs a multi-factor OLS regression of the portfolio
 * return series against an operator-supplied factor universe, then
 * emits an operator-meaningful verdict identifying which factors leak
 * beyond a claimed-neutrality threshold.
 *
 * Algorithm (delegates math to existing primitive):
 *   1. Call `computeHedgeFundReplication` from infra/trading/quant —
 *      solves OLS for portfolio = Σ β_i · factor_i + residual, returning
 *      per-factor weights (= betas), tracking-error stdev, R².
 *   2. Identify "leaking" factors where |β| > hiddenBetaThreshold.
 *   3. Compute the alpha-leak diagnostic: for each leaking factor,
 *      estimate the portfolio's expected directional drift over the
 *      sample period as β × mean(factor_returns).
 *
 * Verdict bands:
 *   - factor_neutral        : 0 leaking factors above threshold
 *   - hidden_beta_single    : exactly 1 leaking factor
 *   - hidden_beta_multiple  : 2+ leaking factors
 *   - insufficient_data     : sample too small or no factors supplied
 *
 * Distinct from:
 *   - `hedgeFundReplication.ts`   (math layer; produces weights + R²
 *                                   but no claimed-neutrality verdict
 *                                   or which-factor-leaks summary)
 *   - `kalmanBeta.ts`              (single-factor dynamic beta; this
 *                                   primitive is multi-factor static)
 *   - `effectiveN.ts` /
 *     `pcaConcentration.ts`        (correlation-structure of positions;
 *                                   different question)
 *   - `marginal-contribution.ts`   (strategy redundancy via correlation;
 *                                   not factor-orthogonality)
 *
 * Composes with:
 *   - `marginal-contribution`      (strategy claims diversification;
 *                                   verify each strategy is factor-
 *                                   neutral before trusting the
 *                                   diversification claim)
 *   - `strategyEdgeThesisTools`    (ET1 — if thesis says "market
 *                                   neutral carry harvest," this
 *                                   primitive verifies it)
 *
 * Pure compute. Pedigree: algo trader 2026 "dirty carry trap" video.
 */

import {
  computeHedgeFundReplication,
  type FactorSeries,
  type ReplicationResult,
} from "../../infra/trading/quant/hedgeFundReplication.ts";

export interface HiddenBetaVerifierInput {
  /** Portfolio return series (oldest → newest). */
  portfolioReturns: ReadonlyArray<number>;
  /** Factor return series to regress against. ≥1 required. */
  factors: ReadonlyArray<FactorSeries>;
  /**
   * Max |β| considered "neutral" per factor. Default 0.10 (10% loading).
   * Tighter institutional convention: 0.05.
   */
  hiddenBetaThreshold?: number;
  /** Minimum sample size for a verdict. Default 30. */
  minSampleSize?: number;
}

export interface FactorBetaCheck {
  factorId: string;
  beta: number;
  betaMagnitude: number;
  /** True iff |β| > hiddenBetaThreshold. */
  exceedsThreshold: boolean;
  /**
   * Estimated portfolio drift attributable to this factor over the sample
   * period: β × mean(factor_returns) × sampleSize. Signed; positive means
   * the hidden beta contributed positive return.
   */
  estimatedAlphaLeak: number;
}

export type HiddenBetaVerdict =
  | "factor_neutral"
  | "hidden_beta_single"
  | "hidden_beta_multiple"
  | "insufficient_data";

export interface HiddenBetaVerifierResult {
  sampleSize: number;
  factorsTested: number;
  hiddenBetaThreshold: number;
  /** R² of the multi-factor fit. High = factors explain most variance. */
  factorExplainedRSquared: number;
  /** 1 - factorExplainedRSquared. */
  residualVarianceFraction: number;
  trackingErrorStdev: number;
  perFactor: FactorBetaCheck[];
  /** Factor IDs where |β| exceeds the threshold. */
  leakingFactors: string[];
  /** Total estimated alpha leak across all factors (signed sum). */
  totalEstimatedAlphaLeak: number;
  verdict: HiddenBetaVerdict;
  /** 0..1 confidence in the neutrality claim. Higher = more neutral. */
  neutralityConfidence: number;
  summary: string;
}

const DEFAULT_THRESHOLD = 0.10;
const DEFAULT_MIN_SAMPLE = 30;

function meanOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function insufficient(
  reason: string,
  portfolioLength: number,
  factorCount: number,
  threshold: number,
): HiddenBetaVerifierResult {
  return {
    sampleSize: portfolioLength,
    factorsTested: factorCount,
    hiddenBetaThreshold: threshold,
    factorExplainedRSquared: 0,
    residualVarianceFraction: 1,
    trackingErrorStdev: 0,
    perFactor: [],
    leakingFactors: [],
    totalEstimatedAlphaLeak: 0,
    verdict: "insufficient_data",
    neutralityConfidence: 0,
    summary: reason,
  };
}

export function verifyHiddenBeta(
  input: HiddenBetaVerifierInput,
): HiddenBetaVerifierResult {
  const threshold = input.hiddenBetaThreshold ?? DEFAULT_THRESHOLD;
  const minSample = input.minSampleSize ?? DEFAULT_MIN_SAMPLE;

  if (input.factors.length === 0) {
    return insufficient(
      "No factor series supplied.",
      input.portfolioReturns.length,
      0,
      threshold,
    );
  }
  if (input.portfolioReturns.length < minSample) {
    return insufficient(
      `Portfolio sample size ${input.portfolioReturns.length} < ${minSample}.`,
      input.portfolioReturns.length,
      input.factors.length,
      threshold,
    );
  }
  // Check factor sample sizes
  for (const f of input.factors) {
    if (f.returns.length < minSample) {
      return insufficient(
        `Factor ${f.id} sample size ${f.returns.length} < ${minSample}.`,
        input.portfolioReturns.length,
        input.factors.length,
        threshold,
      );
    }
  }

  // Delegate OLS math to existing primitive
  let fit: ReplicationResult;
  try {
    fit = computeHedgeFundReplication({
      targetReturns: input.portfolioReturns,
      factors: input.factors,
      normalizeWeights: false,
    });
  } catch (err) {
    return insufficient(
      `Regression failed: ${err instanceof Error ? err.message : String(err)}`,
      input.portfolioReturns.length,
      input.factors.length,
      threshold,
    );
  }

  // Build per-factor checks + leakage estimate
  const perFactor: FactorBetaCheck[] = [];
  const leakingFactors: string[] = [];
  let totalLeak = 0;
  for (const w of fit.weights) {
    const factor = input.factors.find((f) => f.id === w.id);
    if (!factor) continue; // shouldn't happen
    const magnitude = Math.abs(w.weight);
    const exceeds = magnitude > threshold;
    const factorMean = meanOf(factor.returns);
    const leak = w.weight * factorMean * fit.sampleSize;
    if (exceeds) leakingFactors.push(w.id);
    totalLeak += leak;
    perFactor.push({
      factorId: w.id,
      beta: parseFloat(w.weight.toFixed(6)),
      betaMagnitude: parseFloat(magnitude.toFixed(6)),
      exceedsThreshold: exceeds,
      estimatedAlphaLeak: parseFloat(leak.toFixed(8)),
    });
  }

  let verdict: HiddenBetaVerdict;
  if (leakingFactors.length === 0) verdict = "factor_neutral";
  else if (leakingFactors.length === 1) verdict = "hidden_beta_single";
  else verdict = "hidden_beta_multiple";

  // Confidence: 1 when zero leakage AND high residual variance fraction
  // (most of portfolio variance is idiosyncratic). Drops with leakage and
  // with R² (more factor-explained variance).
  const residualFrac = 1 - fit.rSquared;
  const maxMag =
    perFactor.length > 0
      ? Math.max(...perFactor.map((p) => p.betaMagnitude))
      : 0;
  const magPenalty = Math.min(1, maxMag / Math.max(threshold * 3, 0.001));
  const rSqPenalty = Math.min(1, Math.max(0, fit.rSquared));
  const neutralityConfidence = parseFloat(
    (Math.max(0, 1 - magPenalty * 0.6 - rSqPenalty * 0.4)).toFixed(4),
  );

  const summary =
    verdict === "factor_neutral"
      ? `FACTOR NEUTRAL — all ${perFactor.length} factor |β| within ±${(threshold * 100).toFixed(0)}% threshold. R²=${fit.rSquared.toFixed(3)}, residual=${(residualFrac * 100).toFixed(1)}%.`
      : verdict === "hidden_beta_single"
        ? `HIDDEN BETA on ${leakingFactors[0]} (|β|=${perFactor.find((p) => p.factorId === leakingFactors[0])!.betaMagnitude.toFixed(3)}). Claimed neutrality is FALSE. Estimated alpha leak ${(totalLeak * 100).toFixed(2)}% over sample.`
        : verdict === "hidden_beta_multiple"
          ? `HIDDEN BETA on ${leakingFactors.length} factors: ${leakingFactors.join(", ")}. Claimed neutrality is FALSE. Estimated alpha leak ${(totalLeak * 100).toFixed(2)}% over sample.`
          : `Insufficient data.`;

  return {
    sampleSize: fit.sampleSize,
    factorsTested: input.factors.length,
    hiddenBetaThreshold: threshold,
    factorExplainedRSquared: parseFloat(fit.rSquared.toFixed(6)),
    residualVarianceFraction: parseFloat(residualFrac.toFixed(6)),
    trackingErrorStdev: parseFloat(fit.trackingErrorStdev.toFixed(8)),
    perFactor,
    leakingFactors,
    totalEstimatedAlphaLeak: parseFloat(totalLeak.toFixed(8)),
    verdict,
    neutralityConfidence,
    summary,
  };
}

export function formatHiddenBetaVerifier(
  result: HiddenBetaVerifierResult,
): string {
  const lines = [
    `Hidden Beta Verifier — ${result.verdict.toUpperCase()} (confidence ${result.neutralityConfidence.toFixed(2)})`,
    "",
    `  Sample size:                ${result.sampleSize}`,
    `  Factors tested:             ${result.factorsTested}`,
    `  Threshold (|β| > X):        ${result.hiddenBetaThreshold.toFixed(3)}`,
    `  Factor-explained R²:        ${result.factorExplainedRSquared.toFixed(3)}`,
    `  Residual variance fraction: ${(result.residualVarianceFraction * 100).toFixed(1)}%`,
    `  Tracking error stdev:       ${result.trackingErrorStdev.toExponential(3)}`,
    "",
    `  Per-factor:`,
  ];
  for (const f of result.perFactor) {
    const tag = f.exceedsThreshold ? "[LEAK]" : "[ok]  ";
    lines.push(
      `    ${tag} ${f.factorId.padEnd(12)} β=${f.beta.toFixed(4)}  leak=${(f.estimatedAlphaLeak * 100).toFixed(2)}%`,
    );
  }
  if (result.leakingFactors.length > 0) {
    lines.push("");
    lines.push(`  Leaking factors: ${result.leakingFactors.join(", ")}`);
    lines.push(
      `  Total estimated alpha leak: ${(result.totalEstimatedAlphaLeak * 100).toFixed(2)}%`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
