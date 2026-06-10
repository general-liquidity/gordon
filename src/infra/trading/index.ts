/**
 * Trading Infrastructure — Vibe Trading Equivalents of Claude Code Patterns
 *
 *   - Strategy Sandbox:     git worktrees → isolated parallel strategies
 *   - Portfolio Diff:       diff viewer → before/after portfolio visualization
 *   - Market Context:       LSP → hover symbol → live quote + position + P&L
 *   - Risk Classifier:      bash classifier → multi-dimensional trade risk scoring
 *   - Strategy Checkpoint:  undo/checkpoint → save/restore portfolio snapshots
 *   - Auto-Rebalance:       auto-fix PR → detect drift → rebalance → execute
 *   - Atomic Execution:     multi-edit atomic → all-or-nothing order groups
 *   - Prefetch Pipeline:    speculation → pre-fetch data for likely next action
 *   - Shadow Mode:          ghost-fill recording for paper/shadow execution parity
 *   - Auto-Optimizer:       hill-climbing strategy parameter search (internal ops API)
 */

/**
 * Export graduation convention:
 * modules start private while experimental; graduate to this barrel only when
 * they have tests, stable typed inputs/outputs, and a caller-facing lifecycle
 * (tool, producer, skill, or documented internal ops API). Staging modules stay
 * unexported until they meet that bar; exported modules are safe for agent/tool
 * wiring and should preserve API compatibility or get an explicit migration.
 */

// Strategy Sandbox
export {
  StrategySandbox,
  createSandbox,
  getSandbox,
  listSandboxes,
  removeSandbox,
  compareSandboxes,
} from "./ops/strategySandbox.ts";
export type { SandboxConfig, SandboxSnapshot, VirtualPosition, VirtualTrade } from "./ops/strategySandbox.ts";

// Portfolio Diff
export {
  computePortfolioDiff,
  formatPortfolioDiff,
} from "./portfolio/portfolioDiff.ts";
export type { PortfolioDiff, PositionDiff, PortfolioState, PositionState, DiffAction } from "./portfolio/portfolioDiff.ts";

// Market Context Protocol
export {
  MarketContextCache,
  getMarketContext,
  formatSymbolHover,
} from "./signals/marketContext.ts";
export type { SymbolContext, OrderContext, MarketContextProvider } from "./signals/marketContext.ts";

// Risk Classifier
export {
  classifyTradeRisk,
  DEFAULT_CLASSIFIER_CONFIG,
} from "./risk/riskClassifier.ts";
export type { RiskAssessment, RiskTier, RiskDimension, TradeProposal, PortfolioContext, ClassifierConfig } from "./risk/riskClassifier.ts";

// Strategy Checkpointing
export {
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  getLatestCheckpoint,
  compareCheckpoints,
  formatCheckpoint,
} from "./ops/strategyCheckpoint.ts";
export type { PortfolioCheckpoint } from "./ops/strategyCheckpoint.ts";

// Auto-Rebalance Cycle
export {
  createRebalanceCycle,
  startStep,
  completeStep,
  failStep,
  cancelCycle,
  completeCycle,
  detectDrift,
  formatCycleStatus,
  DEFAULT_REBALANCE_CONFIG,
} from "./portfolio/autoRebalance.ts";
export type { RebalanceCycle, RebalanceStep, RebalanceProposal, DriftDetection, RebalanceConfig } from "./portfolio/autoRebalance.ts";

// Multi-Leg Atomic Execution
export {
  executeAtomicGroup,
  formatAtomicGroup,
} from "./ops/atomicExecution.ts";
export type { OrderLeg, LegResult, AtomicGroup, OrderSubmitter, OrderCanceller } from "./ops/atomicExecution.ts";

// Shadow Mode (Paper/Ghost Fill Tracking)
export {
  SHADOW_FLAG_ENV,
  SHADOW_PATH_ENV,
  isShadowModeEnabled,
  defaultShadowFillsPath,
  recordShadowOpen,
  recordShadowClose,
  readShadowFills,
  summarizeShadowFills,
  compareShadowVsReal,
} from "./ops/shadowMode.ts";
export type {
  ShadowStatus,
  ShadowSide,
  ShadowFill,
  OpenShadowInput,
  CloseShadowInput,
  ShadowReadOptions,
  ShadowSummary,
  ShadowVsRealComparison,
} from "./ops/shadowMode.ts";

// Prefetch Pipeline
export {
  PrefetchPipeline,
  getPrefetchPipeline,
  resetPrefetchPipeline,
  buildPrefetchTasks,
} from "./ops/prefetchPipeline.ts";
export type { PrefetchTask, PrefetchTrigger } from "./ops/prefetchPipeline.ts";

// Evaluation Feedback Loop
export {
  recordTradeOutcome,
  getPatternConfidence,
  getPatternStats,
  getAllPatternStats,
  formatFeedbackForPrompt,
} from "./ops/feedbackLoop.ts";
export type { TradeOutcome, PatternStats } from "./ops/feedbackLoop.ts";

// Volatility-Percentile Position Sizing
export {
  computePositionSize,
  computeVolatilityProfile,
  computeAnnualizedVol,
  pricesToReturns,
  buildVolDistribution,
} from "./risk/volatilityPositionSizing.ts";
export type { VolatilityProfile, PositionSizeResult } from "./risk/volatilityPositionSizing.ts";

// Correlation-Adjusted Position Limits
export {
  checkCorrelationRisk,
  pearsonCorrelation,
  buildCorrelationMatrix,
  correlationMultiplier,
} from "./risk/correlationLimits.ts";
export type { CorrelationCheck } from "./risk/correlationLimits.ts";

// Scenario-Based Valuation (DCF)
export {
  runScenarioValuation,
} from "./quant/scenarioValuation.ts";
export type { ValuationResult, ScenarioResult, DCFInputs } from "./quant/scenarioValuation.ts";

// Hurst Exponent (Regime Detection)
export {
  computeHurstExponent,
  interpretHurst,
} from "./quant/hurstExponent.ts";
export type { HurstAnalysis, HurstRegime } from "./quant/hurstExponent.ts";

// Tail Risk Scoring
export {
  computeTailRisk,
} from "./risk/tailRisk.ts";
export type { TailRiskProfile } from "./risk/tailRisk.ts";

// Cointegration Test (Pairs Trading)
export {
  testCointegration,
  formatCointegrationResult,
  DEFAULT_SIGNAL_CONFIG,
} from "./quant/cointegration.ts";
export type { CointegrationResult, PairsTradeSignal } from "./quant/cointegration.ts";

// Market Efficiency Tests (Pre-Trade Filters)
export {
  ljungBoxTest,
  varianceRatioTest,
  runsTest,
  assessMarketEfficiency,
} from "./quant/marketEfficiency.ts";
export type { EfficiencyTestResult, MarketEfficiencyProfile } from "./quant/marketEfficiency.ts";

// Granger Causality (Lead-Lag Prediction)
export {
  grangerCausalityTest,
  bidirectionalGrangerTest,
} from "./quant/grangerCausality.ts";
export type { GrangerResult, BiDirectionalGrangerResult } from "./quant/grangerCausality.ts";

// Black-Litterman Portfolio Optimization
export { blackLitterman } from "./portfolio/blackLitterman.ts";
export type { BlackLittermanInputs, BlackLittermanResult, InvestorView } from "./portfolio/blackLitterman.ts";

// Volatility-Targeting + Drawdown Overlay
export {
  computeVolTargetScale,
  computeDrawdownScale,
  computeOverlay,
  DEFAULT_VOL_TARGET_CONFIG,
  DEFAULT_DRAWDOWN_CONFIG,
} from "./risk/drawdownOverlay.ts";
export type { VolTargetConfig, DrawdownOverlayConfig, OverlayResult } from "./risk/drawdownOverlay.ts";

// Backtest Credibility Tests
export {
  probabilisticSharpeRatio,
  deflatedSharpeRatio,
  minimumTrackRecordLength,
  combinatorialPurgedCV,
  assessBacktestCredibility,
} from "./ops/backtestCredibility.ts";
export type { SharpeCredibilityResult, CPCVResult } from "./ops/backtestCredibility.ts";

// Kalman Filter (Adaptive Price Smoothing)
export {
  kalmanFilter,
  kalmanUpdate,
  kalmanSignal,
  autoTuneKalman,
  DEFAULT_KALMAN_CONFIG,
} from "./quant/kalmanFilter.ts";
export type { KalmanState, KalmanConfig, KalmanResult } from "./quant/kalmanFilter.ts";

// Markov Chain Regime Detection
export {
  analyzeMarkovRegime,
  DEFAULT_MARKOV_CONFIG,
} from "./quant/markovRegime.ts";
export type { MarkovRegimeResult, MarkovState, TransitionMatrix, MarkovConfig } from "./quant/markovRegime.ts";

// Orderflow Delta Ladder
export {
  analyzeOrderflow,
  DEFAULT_ORDERFLOW_CONFIG,
} from "./signals/orderflowDelta.ts";
export type { OrderflowResult, DeltaBar, OHLCV, OrderflowConfig } from "./signals/orderflowDelta.ts";

// Auto-Optimizer (Self-Improving Strategies)
export {
  runAutoOptimization,
  PRESET_DIRECTIVES,
} from "./portfolio/autoOptimizer.ts";
export type {
  OptimizationDirective,
  StrategyParameters,
  BacktestScore,
  OptimizationResult,
} from "./portfolio/autoOptimizer.ts";

// Optimizer Enhancements (Recursive-Improve patterns)
export {
  createRatchetHistory,
  recordRatchetEntry,
  saveRatchetHistory,
  loadLatestRatchetHistory,
  diagnoseFailure,
  generateTargetedMutation,
  initializeIslands,
  crossPollinate,
  getBestIsland,
  formatIslandStatus,
  DEFAULT_ISLAND_CONFIG,
} from "./portfolio/optimizerEnhancements.ts";
export type {
  RatchetEntry,
  RatchetHistory,
  Diagnosis,
  WeaknessCategory,
  Island,
  IslandEvolutionConfig,
} from "./portfolio/optimizerEnhancements.ts";

// Reflexivity Engine (Soros Theory)
export { assessReflexivity } from "./quant/reflexivity.ts";
export type { ReflexivityAssessment, ReflexivityInputs, FeedbackSignal, FeedbackLoopType } from "./quant/reflexivity.ts";

// Janus Meta-Weighting (Dynamic Signal Source Weighting)
export {
  updateWeights,
  detectEmergentRegime,
  blendRecommendations,
  runMetaWeighting,
  DEFAULT_META_WEIGHTING_CONFIG,
} from "./portfolio/metaWeighting.ts";
export type { SignalSource, WeightedPrediction, BlendedRecommendation, EmergentRegime, MetaWeightingResult, MetaWeightingConfig } from "./portfolio/metaWeighting.ts";

// Synthetic Futures Generator (Monte Carlo)
export { generateSyntheticFutures, formatFuturesSummary } from "./signals/syntheticFutures.ts";
export type { AssetConfig, CorrelationPair, ScenarioEvent, FuturesConfig, FuturesResult, ScenarioType } from "./signals/syntheticFutures.ts";
