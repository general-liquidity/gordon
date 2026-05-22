/**
 * Alpha diagnostic module — operator-facing visibility into
 * signal quality (IC), independence (effective N), combined edge
 * (IR), and per-dimension attribution of risk-classifier verdicts.
 *
 * These are DIAGNOSTICS, not gates. They surface what the existing
 * Gordon infrastructure is doing under the hood — the disciplined
 * answer to the question the influencer post claimed to solve.
 *
 * Combine with the cost-aware Kelly + Markov-stability gate + regime-
 * transition risk dimension shipped in commit e6a31f0c for the
 * complete "less wrong" stack.
 */

export {
  trackIc,
  computeIc,
  type IcSnapshot,
  type IcVerdict,
  type IcOptions,
  type EdgeDiagnostic,
} from "./ic-tracker.ts";

export {
  walkForwardIc,
  type WalkForwardIcResult,
  type WalkForwardIcOptions,
  type WalkForwardVerdict,
  type WalkForwardWindow,
} from "./walk-forward-ic.ts";

export {
  computeEffectiveN,
  type EffectiveNResult,
  type EffectiveNOptions,
  type PairCorrelation,
} from "./effective-n.ts";

export {
  computeIrDiagnostic,
  type IrDiagnostic,
  type IrVerdict,
  type IrDiagnosticOptions,
} from "./ir-diagnostic.ts";

export {
  explainCompositeAttribution,
  formatAttributionTable,
  type CompositeAttribution,
  type DimensionAttribution,
} from "./composite-attribution.ts";

export {
  pearsonCorrelation,
  sampleStd,
  trendSlope,
  ci95HalfWidth,
  coefficientOfVariation,
  mean,
} from "./helpers.ts";

export {
  computeMarginalContribution,
  equityCurveToReturns,
  type MarginalContribution,
  type MarginalContributionVerdict,
  type MarginalContributionOptions,
  type DrawdownOverlapAnalysis,
} from "./marginal-contribution.ts";

export {
  optimizePortfolio,
  type PortfolioOptimizerInput,
  type OptimalPortfolio,
  type OptimizationObjective,
} from "./portfolio-optimizer.ts";

export {
  transpose,
  multiply,
  multiplyVector,
  dot,
  invert,
  shrinkToDiagonal,
  computeCovarianceMatrix,
} from "./matrix.ts";

export {
  checkTooGoodToBeTrue,
  formatTooGoodCheck,
  type TooGoodCheckInput,
  type TooGoodCheckOptions,
  type TooGoodCheckResult,
  type TooGoodVerdict,
  type TooGoodSeverity,
  type TrippedCheck,
} from "./too-good-check.ts";
