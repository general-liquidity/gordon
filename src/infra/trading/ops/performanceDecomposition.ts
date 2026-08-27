/**
 * Performance Decomposition (GORDON_PERFORMANCE_DECOMPOSITION).
 *
 * Port of Ch 11 from Ryan Wright. Decompose realized returns into the
 * three components that determine whether they represent skill:
 *
 *   Return = Market Beta + Factor Exposures + Alpha
 *
 *   Beta is the tide — return earned by baseline market exposure.
 *   Factors are currents — returns from systematic risks (momentum,
 *     value, carry, vol-premium, size).
 *   Alpha is the residual — what's left after stripping both, your
 *     genuine idiosyncratic skill.
 *
 * Wright's diagnostic from Archegos: Bill Hwang's 17,500% run looked
 * like genius; decomposition shows it was leveraged beta + momentum
 * factor + concentrated tech-sector tilt. Zero residual alpha. When
 * the tide receded the structure collapsed in three days.
 *
 * Distinct from `multipleTestingTracker` (Q4 — DSR/PSR for trial-count
 * inflation) and `evals/tradeEvaluator` (realized PnL ensemble). This
 * answers a different question: of the returns you DID realize, how
 * much was you and how much was the environment?
 */

export type FactorName = "momentum" | "value" | "carry" | "volatility_premium" | "size" | "sector";

export interface FactorExposure {
  factor: FactorName | string;
  /** Portfolio loading on the factor (e.g. 0.5 = 50% beta to factor). */
  loading: number;
  /** Factor's realized return over the period. */
  factorReturn: number;
}

export interface DecompositionInput {
  /** Total realized return over the window. */
  totalReturn: number;
  /** Market return over the same window. */
  marketReturn: number;
  /** Portfolio's beta to the market. */
  marketBeta: number;
  /** Factor exposures. */
  factors: ReadonlyArray<FactorExposure>;
}

export interface DecompositionResult {
  totalReturn: number;
  betaContribution: number;
  factorContributions: Record<string, number>;
  factorTotal: number;
  alpha: number;
  alphaFractionOfTotal: number;
  verdict: "skill" | "factor_harvester" | "leveraged_beta" | "noise";
}

export function decomposeReturns(input: DecompositionInput): DecompositionResult {
  const betaContribution = input.marketBeta * input.marketReturn;
  const factorContributions: Record<string, number> = {};
  let factorTotal = 0;
  for (const f of input.factors) {
    const contrib = f.loading * f.factorReturn;
    factorContributions[f.factor] = contrib;
    factorTotal += contrib;
  }
  const alpha = input.totalReturn - betaContribution - factorTotal;
  const alphaFraction = input.totalReturn !== 0 ? alpha / input.totalReturn : 0;

  let verdict: DecompositionResult["verdict"];
  if (Math.abs(alpha) < 0.01) {
    verdict = "noise";
  } else if (alphaFraction >= 0.5) {
    verdict = "skill";
  } else if (
    Math.abs(betaContribution) > Math.abs(factorTotal) &&
    Math.abs(betaContribution) > Math.abs(alpha)
  ) {
    verdict = "leveraged_beta";
  } else {
    verdict = "factor_harvester";
  }

  return {
    totalReturn: input.totalReturn,
    betaContribution,
    factorContributions,
    factorTotal,
    alpha,
    alphaFractionOfTotal: alphaFraction,
    verdict,
  };
}

export function formatDecomposition(result: DecompositionResult): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`Decomposition: ${pct(result.totalReturn)} total return`);
  lines.push(`  Beta:    ${pct(result.betaContribution)}`);
  lines.push(`  Factors: ${pct(result.factorTotal)}`);
  lines.push(
    `  Alpha:   ${pct(result.alpha)} (${pct(result.alphaFractionOfTotal)} of total) → ${result.verdict}`,
  );
  return lines.join("\n");
}

export function decompositionToPayload(result: DecompositionResult): Record<string, unknown> {
  return {
    kind: "performance_decomposition.computed",
    totalReturn: Number(result.totalReturn.toFixed(4)),
    betaContribution: Number(result.betaContribution.toFixed(4)),
    factorTotal: Number(result.factorTotal.toFixed(4)),
    alpha: Number(result.alpha.toFixed(4)),
    verdict: result.verdict,
  };
}
