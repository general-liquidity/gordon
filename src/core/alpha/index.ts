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
} from "./ic-tracker.ts";

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
