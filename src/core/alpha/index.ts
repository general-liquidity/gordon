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
  computePSI,
  type PSIResult,
  type PSIBin,
  type DriftVerdict,
} from "./distribution-drift.ts";

export {
  classifyMarketBreadth,
  type MarketBreadthInput,
  type MarketBreadthBias,
  type SymbolSnapshot,
  type DirectionBias,
  type StrategyBias,
  type FavoredStrategy,
} from "./market-breadth-bias.ts";

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
  ledoitWolfCovariance,
  computeCovarianceMatrix,
  eigenDecomposition,
} from "./matrix.ts";

export {
  computeResidualSScore,
  computeResidualSScores,
  type ResidualSScore,
} from "./eigenportfolio-residual.ts";

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

export {
  analyzeSmtDivergence,
  formatSmtDivergence,
  type AssetSnapshot,
  type SmtDivergenceOptions,
  type SmtDivergenceResult,
  type SmtVerdict,
  type PerAssetSweepStatus,
} from "./smt-divergence.ts";

export {
  detectPsp,
  formatPsp,
  type PspBar,
  type PspOptions,
  type PspResult,
  type PspVerdict,
  type PspAssetStatus,
  type BarDirection,
  type MajorityDirection,
} from "./psp-detector.ts";

export {
  estimateLatencyCost,
  formatLatencyCost,
  type LatencyCostInput,
  type LatencyCostResult,
  type LatencyCostVerdict,
} from "./latency-cost.ts";

export {
  scoreDarkPoolAdverseSelection,
  formatDarkPoolAdverseSelection,
  type DarkPoolFill,
  type DarkPoolAdverseSelectionOptions,
  type DarkPoolAdverseSelectionResult,
  type DarkPoolVerdict,
} from "./dark-pool-adverse-selection.ts";

export {
  rankCrossSectionalMomentum,
  formatCrossSectionalMomentum,
  type AssetReturnSeries,
  type CrossSectionalMomentumOptions,
  type CrossSectionalMomentumResult,
  type RankedAsset,
  type RankPosition,
  type MomentumVerdict,
} from "./cross-sectional-momentum.ts";

export {
  sizeWithWipeoutCap,
  formatWipeoutCap,
  type WipeoutCapInput,
  type WipeoutCapResult,
  type SizingVerdict,
} from "./wipeout-cap-sizer.ts";

export {
  verifyStrategyClaims,
  formatStrategyClaimVerification,
  type StrategyClaim,
  type StrategyClaimVerifierInput,
  type StrategyClaimVerifierResult,
  type ClaimCheckResult,
  type ClaimVerdict,
  type OverallVerdict,
} from "./strategy-claim-verifier.ts";

export {
  computeInventoryAdjustedSpread,
  formatInventoryAdjustedSpread,
  type InventoryAdjustedSpreadInput,
  type InventoryAdjustedSpreadResult,
  type SpreadVerdict,
} from "./inventory-adjusted-spread.ts";

export {
  classifyTailConditionalHedges,
  formatTailConditionalHedge,
  type HedgeCandidate,
  type TailConditionalHedgeInput,
  type TailConditionalHedgeResult,
  type HedgeClassification,
  type HedgeReliability,
} from "./tail-conditional-hedge.ts";

export {
  computeAggressionRatio,
  formatAggressionRatio,
  type TakerVolumeBar,
  type AggressionRatioOptions,
  type AggressionRatioResult,
  type AggressionVerdict,
} from "./aggression-ratio.ts";

export {
  reweightSignals,
  formatSignalReweighting,
  type SignalPerformance,
  type SignalReweightingOptions,
  type SignalReweightingResult,
  type SignalWeightAssignment,
  type ReweightingVerdict,
} from "./signal-recency-reweighting.ts";

export {
  simulateConvictionFilteredExpectancy,
  formatConvictionFilteredExpectancy,
  type TradeRecord,
  type ConvictionFilteredExpectancyOptions,
  type ConvictionFilteredExpectancyResult,
  type ThresholdSimulation,
  type ConvictionVerdict,
} from "./conviction-filtered-expectancy.ts";

export {
  rankIbsCrossSectional,
  formatIbsCrossSectional,
  type IbsBar,
  type IbsCrossSectionalOptions,
  type IbsCrossSectionalResult,
  type RankedIbsAsset,
  type IbsPosition,
  type IbsVerdict,
} from "./ibs-cross-sectional.ts";

export {
  sizeCrossSectionalContrarian,
  formatCrossSectionalContrarian,
  type ContrarianAsset,
  type CrossSectionalContrarianOptions,
  type CrossSectionalContrarianResult,
  type ContrarianWeight,
  type ContrarianVerdict,
  type VolatilityWeighting,
} from "./cross-sectional-contrarian.ts";

export {
  analyzeInstitutionalFootprint,
  formatInstitutionalFootprint,
  type InstitutionalFootprintBar,
  type InstitutionalFootprintOptions,
  type InstitutionalFootprintResult,
  type InstitutionalFootprintVerdict,
  type AxisCheck,
} from "./institutional-footprint.ts";

export {
  analyzeFillQualityProbe,
  formatFillQualityProbe,
  type ProbeSide,
  type FillQualityProbeInput,
  type FillQualityProbeOptions,
  type FillQualityProbeResult,
  type FillQualityVerdict,
  type AxisScore,
} from "./fill-quality-probe.ts";

export {
  analyzeStallCut,
  formatStallCut,
  type PositionSide,
  type StallBar,
  type StallCutInput,
  type StallCutOptions,
  type StallCutResult,
  type StallVerdict,
} from "./stall-cut-tracker.ts";

export {
  analyzeBreakoutFailureRegime,
  formatBreakoutFailureRegime,
  type BreakoutOutcome,
  type BreakoutEvent,
  type BreakoutFailureRegimeOptions,
  type BreakoutFailureRegimeResult,
  type BreakoutFailureRegimeVerdict,
} from "./breakout-failure-regime.ts";

export {
  classifyMaCrossoverCleanness,
  formatMaCrossoverCleanness,
  type MaCrossoverBar,
  type MaCrossoverOptions,
  type MaCrossoverResult,
  type MaDirection,
  type TrendCleanness,
  type EdgeActivation,
} from "./ma-crossover-cleanness.ts";

export {
  classifyVolumePatternEdge,
  formatVolumePatternEdge,
  type VolumePatternBar,
  type VolumePatternOptions,
  type VolumePatternResult,
  type VolumePattern,
  type VolumeEdge,
} from "./volume-pattern-edge.ts";

export {
  calibrateMaeStop,
  formatMaeStopCalibrator,
  type CalibratorSide,
  type CalibratorTrade,
  type MaeStopCalibratorOptions,
  type MaeStopCalibratorResult,
  type MaeCalibratorVerdict,
  type ExcursionDistribution,
  type PerTradeExcursion,
} from "./mae-stop-calibrator.ts";

export {
  checkPreTradeRiskGate,
  formatPreTradeRiskGate,
  type TradeSide,
  type TradeProposal,
  type ExistingPosition,
  type PreTradeRiskGateOptions,
  type PreTradeRiskGateResult,
  type LayerName,
  type LayerStatus,
  type LayerCheck,
  type GateVerdict,
} from "./pre-trade-risk-gate.ts";

export {
  verifyHiddenBeta,
  formatHiddenBetaVerifier,
  type HiddenBetaVerifierInput,
  type HiddenBetaVerifierResult,
  type FactorBetaCheck,
  type HiddenBetaVerdict,
} from "./hidden-beta-verifier.ts";

export {
  estimateFatTailCredibility,
  formatFatTailCredibility,
  type FatTailCredibilityInput,
  type FatTailCredibilityResult,
  type FatTailClass,
  type HillEstimatePoint,
} from "./fat-tail-credibility.ts";

export {
  sizeWithVolTarget,
  formatVolTargetSizer,
  type VolTargetSizerInput,
  type VolTargetSizerOptions,
  type VolTargetSizerResult,
  type VolTargetVerdict,
} from "./vol-target-sizer.ts";

export {
  scoreFipMomentum,
  formatFipMomentum,
  type FipAsset,
  type FipMomentumOptions,
  type FipMomentumResult,
  type FipAssetResult,
  type FipQuality,
  type FipVerdict,
} from "./fip-momentum-quality.ts";

export {
  combineEnsembleSignals,
  formatEnsembleSignal,
  type EnsembleSignal,
  type EnsembleCombinerOptions,
  type EnsembleSignalResult,
  type PerSourceContribution,
  type EnsembleDirection,
  type EnsembleVerdict,
} from "./ensemble-signal-combiner.ts";

export {
  detectDeltaPriceDivergence,
  formatDeltaPriceDivergence,
  type DeltaPriceBar,
  type DeltaPriceDivergenceOptions,
  type DeltaPriceDivergenceResult,
  type DeltaDirection,
  type DivergenceType,
  type DeltaDivergenceVerdict,
} from "./delta-price-divergence.ts";

export {
  computeCryptoFactorModel,
  STYLE_FACTORS,
  type StyleFactor,
  type CryptoTokenInput,
  type TokenFactorScore,
  type CryptoFactorModelResult,
  type CryptoFactorModelOptions,
} from "./crypto-factor-model.ts";

export {
  reversalScore,
  reversalSignal,
  type ReversalSignal,
  type ReversalSignalOptions,
} from "./reversal-strategy.ts";

export {
  regimeAdaptiveSignal,
  classifyRegime,
  efficiencyRatio,
  type RegimeAdaptiveOptions,
} from "./regime-adaptive-strategy.ts";

export {
  retrieveAnalogs,
  type AnalogState,
  type MarketAnalogOptions,
  type AnalogNeighbor,
  type ForwardDistribution,
  type AnalogConfidence,
  type MarketAnalogResult,
} from "./market-analog.ts";
