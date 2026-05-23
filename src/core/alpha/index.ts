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
  analyzeReversalTiming,
  detectReversals,
  formatReversalTiming,
  type Bar,
  type ReversalKind,
  type ReversalPoint,
  type ReversalTimingOptions,
  type ReversalTimingResult,
  type MatchedReversal,
} from "./reversal-timing.ts";

export {
  analyzeCalendarEffect,
  formatCalendarEffect,
  type CalendarReturn,
  type CalendarEffectOptions,
  type CalendarEffectReport,
  type CalendarSegmenter,
  type SegmentStats,
  type SegmentSignificanceTier,
} from "./calendar-effect.ts";

export {
  estimateExpectedReturn,
  formatExpectedReturn,
  DEFAULT_EQUITY_REGIME_ADJUSTMENTS,
  type ExpectedReturnInput,
  type ExpectedReturnResult,
  type ExpectedReturnMethodResult,
  type ExpectedReturnRegime,
  type ValuationInput,
  type ValuationMetricType,
  type RegimeAdjustment,
} from "./expected-return.ts";

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

export {
  analyzeVolumeTrend,
  formatVolumeTrend,
  type VolumeTrendCandle,
  type VolumeTrendOptions,
  type VolumeTrendResult,
  type VolumeTrendVerdict,
  type VolumeDirection,
  type VolumeIntensity,
} from "./volume-trend.ts";

export {
  analyzeFakeLiquidity,
  formatFakeLiquidity,
  type FakeLiquidityCandle,
  type FakeLiquidityOptions,
  type FakeLiquidityResult,
  type FakeLiquidityVerdict,
  type CandleEfficiency,
} from "./fake-liquidity.ts";

export {
  detectVolumeExhaustion,
  formatVolumeExhaustion,
  type VolumeExhaustionInput,
  type VolumeExhaustionResult,
  type ExhaustionStrategy,
  type ExhaustionSeverity,
  type ExhaustionAction,
} from "./volume-exhaustion.ts";

export {
  computeMarginOfError,
  formatMarginOfError,
  type MarginOfErrorInput,
  type MarginOfErrorResult,
  type DirectionalBias,
  type StructuralBias,
  type StrategyDirection,
  type StrategyType,
  type TradeGrade,
  type MarginRecommendation,
} from "./margin-of-error.ts";

export {
  computeRegimeDetectionLag,
  formatRegimeLag,
  type RegimeTransition,
  type RegimeLagOptions,
  type RegimeLagResult,
  type MatchedTransition,
} from "./regime-detection-lag.ts";

export {
  identifyConstraint,
  formatConstraint,
  type EvComponent,
  type EvComponentTarget,
  type ConstraintIdentifierInput,
  type ConstraintIdentifierResult,
  type ComponentDeficit,
} from "./constraint-identifier.ts";

export {
  computeTradeConsistency,
  formatTradeConsistency,
  type TradeExecution,
  type TradeConsistencyOptions,
  type TradeConsistencyResult,
  type ConsistencyVerdict,
  type SubscoreBreakdown,
} from "./trade-consistency.ts";

export {
  detectStreak,
  formatStreak,
  type StreakBar,
  type StreakDirection,
  type StreakDetectorOptions,
  type StreakDetectorResult,
  type ExhaustionVerdict,
} from "./streak-detector.ts";

export {
  analyzeVcpContraction,
  formatVcpContraction,
  type VcpCandle,
  type VcpOptions,
  type VcpResult,
  type VcpVerdict,
} from "./vcp-contraction.ts";

export {
  classifyMaProximity,
  formatMaProximity,
  type MaProximityInput,
  type MaProximityResult,
  type SurfingMa,
  type RrTier,
} from "./ma-proximity.ts";

export {
  detectHighestVolume,
  formatHighestVolume,
  type HveCandle,
  type HveOptions,
  type HveResult,
  type HveVerdict,
  type HveConviction,
} from "./highest-volume-ever.ts";
