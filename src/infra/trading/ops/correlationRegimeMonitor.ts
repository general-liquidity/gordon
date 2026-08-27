/**
 * Correlation Regime Monitor (GORDON_CORRELATION_REGIME).
 *
 * Port of Ch 14 from Wright. In a healthy market, assets move
 * independently — Apple moves on iPhone news, Exxon moves on oil.
 * In a liquidity crisis, correlations spike toward 1.0 and stock-picking
 * dies: you don't have a diversified portfolio, you have a single
 * leveraged bet on the market's plumbing.
 *
 *   "When correlations tighten, your realized risk is exponentially
 *    higher than your theoretical risk."
 *
 * Concrete primitive: given a correlation matrix of recent returns,
 * compute the average pairwise correlation and flag regimes where
 * diversification has effectively collapsed. Composes with WW15
 * riskBundleAuditor (correlation category) and the 60/40 obituary
 * scenario (Ch 14): stocks and bonds rising correlation in 2022 was
 * the regime signal that broke the textbook hedge.
 */

export type CorrelationRegime = "diverse" | "elevated" | "crisis";

export interface CorrelationInput {
  /** Pairwise correlation matrix. Square, symmetric, diagonal = 1. */
  correlations: number[][];
  /** Optional asset labels for reporting. */
  labels?: ReadonlyArray<string>;
}

export interface CorrelationResult {
  averagePairwise: number;
  maxPairwise: number;
  regime: CorrelationRegime;
  diversificationLost: boolean;
  /** True when at least one off-diagonal pair has |r| > 0.95. */
  hasNearPerfectPair: boolean;
  reason: string;
}

const ELEVATED_THRESHOLD = 0.5;
const CRISIS_THRESHOLD = 0.75;

export function evaluateCorrelationRegime(input: CorrelationInput): CorrelationResult {
  const n = input.correlations.length;
  if (n < 2) {
    return {
      averagePairwise: 0,
      maxPairwise: 0,
      regime: "diverse",
      diversificationLost: false,
      hasNearPerfectPair: false,
      reason: "Insufficient assets for correlation analysis",
    };
  }

  let sum = 0;
  let count = 0;
  let max = 0;
  let nearPerfect = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = Math.abs(input.correlations[i]![j]!);
      sum += r;
      count += 1;
      if (r > max) max = r;
      if (r > 0.95) nearPerfect = true;
    }
  }
  const avg = count > 0 ? sum / count : 0;

  let regime: CorrelationRegime;
  if (avg >= CRISIS_THRESHOLD) regime = "crisis";
  else if (avg >= ELEVATED_THRESHOLD) regime = "elevated";
  else regime = "diverse";

  const diversificationLost = regime === "crisis";

  let reason: string;
  if (regime === "crisis") {
    reason = `Average pairwise correlation ${avg.toFixed(2)} ≥ ${CRISIS_THRESHOLD} — diversification has collapsed, exposures are concentrated`;
  } else if (regime === "elevated") {
    reason = `Average correlation ${avg.toFixed(2)} elevated — partial diversification only`;
  } else {
    reason = `Average correlation ${avg.toFixed(2)} healthy — assets moving independently`;
  }

  return {
    averagePairwise: avg,
    maxPairwise: max,
    regime,
    diversificationLost,
    hasNearPerfectPair: nearPerfect,
    reason,
  };
}

export function computeCorrelationMatrix(returns: number[][]): number[][] {
  const n = returns.length;
  if (n === 0) return [];
  const m = returns[0]!.length;
  const mat: number[][] = [];
  const means: number[] = [];
  const stds: number[] = [];
  for (let i = 0; i < n; i++) {
    const series = returns[i]!;
    const mean = series.reduce((s, x) => s + x, 0) / series.length;
    means.push(mean);
    const variance = series.reduce((s, x) => s + (x - mean) * (x - mean), 0) / series.length;
    stds.push(Math.sqrt(variance));
  }
  for (let i = 0; i < n; i++) {
    mat.push([]);
    for (let j = 0; j < n; j++) {
      if (i === j) {
        mat[i]!.push(1);
        continue;
      }
      if (stds[i] === 0 || stds[j] === 0) {
        mat[i]!.push(0);
        continue;
      }
      let cov = 0;
      for (let k = 0; k < m; k++) {
        cov += (returns[i]![k]! - means[i]!) * (returns[j]![k]! - means[j]!);
      }
      cov /= m;
      mat[i]!.push(cov / (stds[i]! * stds[j]!));
    }
  }
  return mat;
}

export function correlationToPayload(result: CorrelationResult): Record<string, unknown> {
  return {
    kind: "correlation_regime.evaluated",
    regime: result.regime,
    average: Number(result.averagePairwise.toFixed(3)),
    max: Number(result.maxPairwise.toFixed(3)),
    diversificationLost: result.diversificationLost,
  };
}
