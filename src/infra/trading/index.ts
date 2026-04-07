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
 */

// Strategy Sandbox
export {
  StrategySandbox,
  createSandbox,
  getSandbox,
  listSandboxes,
  removeSandbox,
  compareSandboxes,
} from "./strategySandbox.ts";
export type { SandboxConfig, SandboxSnapshot, VirtualPosition, VirtualTrade } from "./strategySandbox.ts";

// Portfolio Diff
export {
  computePortfolioDiff,
  formatPortfolioDiff,
} from "./portfolioDiff.ts";
export type { PortfolioDiff, PositionDiff, PortfolioState, PositionState, DiffAction } from "./portfolioDiff.ts";

// Market Context Protocol
export {
  MarketContextCache,
  getMarketContext,
  formatSymbolHover,
} from "./marketContext.ts";
export type { SymbolContext, OrderContext, MarketContextProvider } from "./marketContext.ts";

// Risk Classifier
export {
  classifyTradeRisk,
  DEFAULT_CLASSIFIER_CONFIG,
} from "./riskClassifier.ts";
export type { RiskAssessment, RiskTier, RiskDimension, TradeProposal, PortfolioContext, ClassifierConfig } from "./riskClassifier.ts";

// Strategy Checkpointing
export {
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  getLatestCheckpoint,
  compareCheckpoints,
  formatCheckpoint,
} from "./strategyCheckpoint.ts";
export type { PortfolioCheckpoint } from "./strategyCheckpoint.ts";

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
} from "./autoRebalance.ts";
export type { RebalanceCycle, RebalanceStep, RebalanceProposal, DriftDetection, RebalanceConfig } from "./autoRebalance.ts";

// Multi-Leg Atomic Execution
export {
  executeAtomicGroup,
  formatAtomicGroup,
} from "./atomicExecution.ts";
export type { OrderLeg, LegResult, AtomicGroup, OrderSubmitter, OrderCanceller } from "./atomicExecution.ts";

// Prefetch Pipeline
export {
  PrefetchPipeline,
  getPrefetchPipeline,
  resetPrefetchPipeline,
  buildPrefetchTasks,
} from "./prefetchPipeline.ts";
export type { PrefetchTask, PrefetchTrigger } from "./prefetchPipeline.ts";

// Evaluation Feedback Loop
export {
  recordTradeOutcome,
  getPatternConfidence,
  getPatternStats,
  getAllPatternStats,
  formatFeedbackForPrompt,
} from "./feedbackLoop.ts";
export type { TradeOutcome, PatternStats } from "./feedbackLoop.ts";

// Volatility-Percentile Position Sizing
export {
  computePositionSize,
  computeVolatilityProfile,
  computeAnnualizedVol,
  pricesToReturns,
  buildVolDistribution,
} from "./volatilityPositionSizing.ts";
export type { VolatilityProfile, PositionSizeResult } from "./volatilityPositionSizing.ts";

// Correlation-Adjusted Position Limits
export {
  checkCorrelationRisk,
  pearsonCorrelation,
  buildCorrelationMatrix,
  correlationMultiplier,
} from "./correlationLimits.ts";
export type { CorrelationCheck } from "./correlationLimits.ts";

// Scenario-Based Valuation (DCF)
export {
  runScenarioValuation,
} from "./scenarioValuation.ts";
export type { ValuationResult, ScenarioResult, DCFInputs } from "./scenarioValuation.ts";

// Hurst Exponent (Regime Detection)
export {
  computeHurstExponent,
  interpretHurst,
} from "./hurstExponent.ts";
export type { HurstAnalysis, HurstRegime } from "./hurstExponent.ts";

// Tail Risk Scoring
export {
  computeTailRisk,
} from "./tailRisk.ts";
export type { TailRiskProfile } from "./tailRisk.ts";
