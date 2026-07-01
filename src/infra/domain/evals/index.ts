/**
 * Evals Module Index
 * Learning from trade outcomes using Mastra's eval system patterns
 *
 * This module provides:
 * - Trade outcome tracking and evaluation
 * - Performance metrics calculation
 * - Feedback loop for continuous learning
 * - Agent tools for recording and querying performance
 */

// ============================================================================
// Trade Evaluator
// ============================================================================

export {
  // Types
  TradeOutcomeSchema,
  TradeRecommendationSchema,
  type TradeOutcome,
  type TradeRecommendation,
  type StrategyPerformance,
  type AgentPerformance,

  // Recommendation tracking
  trackRecommendation,
  updateRecommendationStatus,
  getRecommendationByPlanId,
  getActiveRecommendations,

  // Outcome recording
  recordTradeOutcome,
  getTradeOutcomes,

  // Performance calculations
  getStrategyPerformance,
  getAgentPerformance,
  getAllStrategyPerformances,
  getRecentTradeSummary,

  // Database initialization
  initTradeEvaluatorTables,
} from "./tradeEvaluator.ts";

// ============================================================================
// Performance Metrics
// ============================================================================

export {
  // Types
  type TimePeriod,
  type MarketCondition,
  type MarketConditionPerformance,
  type RiskRewardAnalysis,
  type TimeBasedPerformance,
  type SymbolPerformance,
  type PerformanceReport,

  // Win rate analysis
  getWinRateByStrategy,
  getWinRateByTimeframe,

  // Risk-reward analysis
  getRiskRewardAnalysis,

  // Market condition analysis
  getPerformanceByMarketCondition,

  // Symbol analysis
  getPerformanceBySymbol,

  // Time-based analysis
  getTimeBasedPerformance,

  // Comprehensive reporting
  generatePerformanceReport,
  formatPerformanceReport,
} from "./performanceMetrics.ts";

// ============================================================================
// Feedback Loop
// ============================================================================

export {
  // Types
  type PerformanceContext,
  type LearningInsights,

  // Outcome recording
  recordTradeClose,
  trackPlanRecommendation,
  processUnrecordedTrades,

  // Performance context
  generatePerformanceContext,
  formatPerformanceContextForPrompt,

  // Learning insights
  generateLearningInsights,
  formatLearningInsights,

  // Confidence adjustments
  getStrategyConfidenceMultiplier,
  getAgentConfidenceMultiplier,
} from "./feedbackLoop.ts";

// ============================================================================
// Regret Ledger (rejected-candidate falsification loop)
// ============================================================================

export {
  // Schemas
  RegretSideSchema,
  HypotheticalBracketSchema,
  RejectedCandidateSchema,
  HorizonObservationSchema,
  RegretOutcomeSchema,
  DEFAULT_HORIZON_DAYS,

  // Types
  type RegretSide,
  type HypotheticalBracket,
  type RejectedCandidate,
  type HorizonObservation,
  type RegretOutcome,
  type RegretEntry,
  type AmendmentSignal,
  type GateRegretSummary,
  type RegretReview,
  type SummarizeOptions,
  type ReviewParams,

  // Functions
  buildRejectedCandidate,
  elapsedDays,
  scoreCandidateAtHorizon,
  reviewRegret,
  summarizeByGate,
} from "./regretLedger.ts";

// ============================================================================
// Tools
// ============================================================================

export {
  // Individual tools
  recordTradeOutcomeTool,
  getStrategyPerformanceTool,
  getAllStrategyPerformancesTool,
  getPerformanceContextTool,
  getLearningInsightsTool,
  getPerformanceReportTool,
  trackRecommendationTool,
  processUnrecordedTradesTool,
  getWinRateAnalysisTool,
  getRiskRewardAnalysisTool,
  getMarketConditionPerformanceTool,

  // Combined tools object
  evalTools,
} from "./tools.ts";
