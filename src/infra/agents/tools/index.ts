/**
 * Gordon Tools Index
 * All tools for Mastra agents (object-based format)
 *
 * Tools are organized by category:
 * - indicators: Technical analysis (RSI, MACD, Bollinger Bands, etc.)
 * - explain: Educational explanations
 * - market: Market scanning and analysis
 * - positions: Position monitoring
 * - scheduler: Task scheduling
 * - system: System control (arm/disarm)
 * - earn: Staking and savings
 * - charts: Price visualization (ASCII line and candlestick charts)
 * - multiModalCharts: Advanced chart generation with image export and vision analysis
 * - orderbook: Order book and liquidity
 * - wallet: Wallet management
 * - discovery: Coin discovery
 * - history: Trade/transfer history
 * - account: Account information
 * - trading: Plan creation and execution
 * - marketAnalysis: Advanced market analysis (whale detection, breakouts, consolidation, scoring)
 * - riskManagement: Risk management (Kelly sizing, daily limits, exit conditions, drawdown)
 * - strategies: Strategy library (list, detect, scan, suggest)
 * - metrics: Performance metrics and statistics
 * - composition: Tool chaining and composition utilities (sequential, parallel, conditional)
 * - backtest: Backtesting and strategy optimization
 * - parallelAnalysis: Parallel execution tools (multi-coin, multi-timeframe, deep analysis)
 *
 * All tools are automatically wrapped with metrics recording via withToolsMetrics.
 *
 * Tool Enhancement Wrappers:
 * - validation: Input validation with user-friendly error messages
 * - timeout: Per-tool timeout handling
 * - rate-limiter: Per-tool rate limiting
 * - error-translator: User-friendly error message translation
 * - pagination: Result pagination for array-returning tools
 */

// Migrated tools
// Mid-task user elicitation (wired to SideQuestionManager + TUI dialogs)
export { askUserTools, askUserTool } from "./runtime/flow/askUser.ts";
export { indicatorTools } from "./market/indicators.ts";
export { explainTools } from "./strategy/explain.ts";
export { marketTools } from "./market/market.ts";
export { positionTools } from "./account/positions.ts";
export { schedulerTools } from "./runtime/lifecycle/scheduler.ts";
export { systemTools } from "./runtime/flow/system.ts";
export { earnTools } from "./account/earn.ts";
export { chartTools } from "./market/charts.ts";
export { orderbookTools } from "./market/orderbook.ts";
export { walletTools } from "./trading/wallet.ts";
export { discoveryTools } from "./news/discovery.ts";
export { historyTools } from "./runtime/flow/history.ts";
export { skillsTools } from "./runtime/flow/skillsManagement.ts";
export { investigationTools } from "./runtime/flow/investigationTool.ts";
export { executionDisciplineTools } from "./runtime/flow/executionDiscipline.ts";
export { composabilityTools } from "./runtime/flow/composabilityTool.ts";
export { accountTools } from "./account/account.ts";
export { tradingTools } from "./trading/trading.ts";
export { peerTools } from "./peer/peer.ts";
export { marketAnalysisTools } from "./market/market-analysis.ts";
export { riskManagementTools } from "./trading/risk-management.ts";
export { strategyTools } from "./strategy/strategies.ts";
export { strategyGenerationTools } from "./strategy/generation/strategy-generation.ts";
export { metricsTools } from "./strategy/metrics.ts";
export { compositionTools } from "./runtime/flow/composition.ts";
export { backtestTools } from "./strategy/backtest/backtest.ts";
export { parallelAnalysisTools } from "./strategy/parallel-analysis.ts";
export { marketDataTools } from "./market/market-data.ts";
export { liquidationIntelligenceTools } from "./trading/liquidation-intelligence.ts";
export { pairAnalysisTools } from "./market/pair-analysis.ts";
export { autonomousTools } from "./runtime/meta/autonomous.ts";
export { baseOnchainTools } from "./onchain/base/base-onchain.ts";
export { agentKitOnchainTools } from "./onchain/agentkit/agentkit-onchain.ts";
export { agentKitDefiTools } from "./onchain/agentkit/agentkit-defi.ts";
export { polkadotKitAssetTools } from "./onchain/polkadotkit/polkadotkit-assets.ts";
export { polkadotKitStakingTools } from "./onchain/polkadotkit/polkadotkit-staking.ts";
export { polkadotKitDefiTools } from "./onchain/polkadotkit/polkadotkit-defi.ts";
export { solanaKitWalletTools } from "./onchain/solanakit/solanakit-wallet.ts";
export { solanaKitTradingTools } from "./onchain/solanakit/solanakit-trading.ts";
export { solanaKitDefiPerpsTools } from "./onchain/solanakit/solanakit-defi-perps.ts";
export { solanaKitDefiLendingTools } from "./onchain/solanakit/solanakit-defi-lending.ts";
export { solanaKitDefiPoolsTools } from "./onchain/solanakit/solanakit-defi-pools.ts";
export { solanaKitDefiBridgeTools } from "./onchain/solanakit/solanakit-defi-bridge.ts";
export { baseSignalTools } from "./onchain/base/base-signals.ts";
export { baseIndexerTools } from "./onchain/base/base-indexers.ts";
export { uniswapDataTools } from "./onchain/dex/uniswap-data.ts";
export { dexSearchTools } from "./news/dex-search.ts";
export { xSocialTools } from "./news/x-social.ts";
export { cdpWebhookTools } from "./onchain/cdp/cdp-webhooks.ts";
export { cdpSqlTools } from "./onchain/cdp/cdp-sql.ts";
export { cdpPolicyTools } from "./onchain/cdp/cdp-policy.ts";
export { cdpOnrampTools } from "./onchain/cdp/cdp-onramp.ts";
export { cdpEvmMultichainTools } from "./onchain/cdp/cdp-evm-multichain.ts";
export { cdpWebhookReceiverTools } from "./onchain/cdp/cdp-webhook-receiver.ts";
export { proactiveModeTools } from "./runtime/flow/proactive-mode.ts";
export { backtestVerdictTools } from "./strategy/backtest/backtest-verdict.ts";
export { finnhubTools } from "./providers/finnhub-tools.ts";
export { finnhubFundamentalsTools } from "./providers/finnhub-fundamentals-tools.ts";
export { finnhubMarketsTools } from "./providers/finnhub-markets-tools.ts";
export { smcPatternTools } from "./market/smc-pattern-tools.ts";
export { calibrationTools } from "./runtime/meta/calibration-tools.ts";
export { skillLoaderTools } from "./runtime/lifecycle/skill-loader.ts";
export { producerHealthTools } from "./runtime/lifecycle/producer-health-tool.ts";
export { defillamaYieldTools } from "./onchain/dex/defillama-yields.ts";
export { newsTools } from "./news/news.ts";
export { stockNewsTools } from "./news/stockNews.ts";
export { strategyRecipeTools } from "./strategy/generation/strategy-recipes.ts";
export { chainlinkStreamsTools } from "./onchain/chainlink/chainlink-streams.ts";
export { chainlinkFeedsTools } from "./onchain/chainlink/chainlink-feeds.ts";
export { chainlinkCCIPTools } from "./onchain/chainlink/chainlink-ccip.ts";
export { synthDataTools } from "./providers/synthdata.ts";
export { agentRailsTools } from "./runtime/meta/agent-rails.ts";

// Position tracking tools (v0.7)
export { positionTrackingTools } from "./account/position-tracking.ts";

// Risk gate tools (v0.7)
export { checkRiskTool, evaluateOrderRisk } from "./trading/risk-gate.ts";

// Memory tools (v0.7)
export { memoryTools } from "./runtime/meta/memory-tools.ts";

// ACE (Agentic Context Engineering) tools
export { aceTools } from "./runtime/meta/ace-tools.ts";

// Agent self-feedback tool (report_blocked)
export { agentFeedbackTools } from "./runtime/meta/agent-feedback.ts";

// Anti-trap tools (record_user_thesis, record_supervision_outcome)
export { antiTrapTools } from "./runtime/meta/anti-trap.ts";

// Status overview tool (/status slash command target)
export { statusTools } from "./runtime/statusOverview.ts";

// Shadow plan + feedback rating tools (/shadow + /rate slash commands)
export { shadowPlanTools } from "./runtime/shadowPlan.ts";
export { feedbackRatingTools } from "./runtime/feedbackRating.ts";

// Effective-N diagnostic tool (/effective-n slash command)
export { effectiveNTools } from "./runtime/effectiveNDiagnostic.ts";

// Kalman beta diagnostic tool (/kalman-beta slash command)
export { kalmanBetaTools } from "./runtime/kalmanBetaDiagnostic.ts";

// Range volatility diagnostic tool (/range-vol slash command)
export { rangeVolatilityTools } from "./runtime/rangeVolatilityDiagnostic.ts";

// PCA concentration diagnostic tool (/pca-concentration slash command)
export { pcaConcentrationTools } from "./runtime/pcaConcentrationDiagnostic.ts";

// Kaufman TSaM port — 4 wired diagnostics (TS1-TS4).
// TS5-TS15 modules ship as cold quant primitives in src/infra/trading/quant/
// only — no tool surface, no slash command. Import the function directly
// when a real consumer surfaces. See docs/harness-deferred-wiring.md.
export { efficiencyRatioTools } from "./runtime/efficiencyRatioDiagnostic.ts";
export { kaufmanAdaptiveMaTools } from "./runtime/kaufmanAdaptiveMaDiagnostic.ts";
export { marketProfileTools } from "./runtime/marketProfileDiagnostic.ts";
export { tripleScreenTools } from "./runtime/tripleScreenDiagnostic.ts";

// Autoresearch port — bootstrap fragility + vol-scaled sizing + directional-edge sign-randomization.
// (Research-loop keep/revert logic + curated history were redundant with
// the existing `systematic` SQLite store + `harness-evolution` paper port;
// the one novel idea — family-diversity steering — moved into the
// systematic domain as `detectFamilyClustering`.)
export { bootstrapTools } from "./runtime/bootstrapDiagnostic.ts";
export { volScaledSizingTools } from "./runtime/volScaledSizingDiagnostic.ts";
export { directionalEdgeTestTools } from "./runtime/directionalEdgeTestDiagnostic.ts";

// Kissell TCA primitives — institutional credibility surface (Pro edition).
// Agent-callable; no slash commands until breadcrumbs land (see harness-deferred-wiring.md).
export { implementationShortfallTools } from "./runtime/implementationShortfallDiagnostic.ts";
export { efficientTradingFrontierTools } from "./runtime/efficientTradingFrontierDiagnostic.ts";

// Cartea-Jaimungal-Penalva optimal execution primitives (CJ1-CJ4).
// Stochastic-control execution layer above operator-shadow's current needs.
// Agent-callable; no slash commands. Pedigree: Cartea/Jaimungal/Penalva (2015) + Drissi (2024).
export { carteaJaimungalSignalTools } from "./runtime/carteaJaimungalSignalDiagnostic.ts";
export { transientImpactTools } from "./runtime/transientImpactDiagnostic.ts";
export { optimalLimitDepthTools } from "./runtime/optimalLimitDepthDiagnostic.ts";
export { optimalPairsTradingTools } from "./runtime/optimalPairsTradingDiagnostic.ts";

// Trade-management primitives (TM1-TM3). Pragmatic prop-trading discipline:
// FTA early-cut, time-based exit, market-breadth directional bias.
// Agent-callable; direct operator-shadow value.
export { faeFtaCutTools } from "./runtime/faeFtaCutDiagnostic.ts";
export { timeBasedExitTools } from "./runtime/timeBasedExitDiagnostic.ts";
export { marketBreadthBiasTools } from "./runtime/marketBreadthBiasDiagnostic.ts";

// Druckenmiller sizing-discipline primitives (D1-D2).
// Asymmetric sizing: bet big when hot (D1), never bet big to get even (D2).
// Both informational-mode by default — observation, not auto-sizing.
export { hotStreakSizerTools } from "./runtime/hotStreakSizerDiagnostic.ts";
export { revengeTradeGuardTools } from "./runtime/revengeTradeGuardDiagnostic.ts";

// Brier score — calibration metric for probability-emitting components.
export { brierScoreTools } from "./runtime/brierScoreDiagnostic.ts";

// Level-volume tactical primitives (LV1-LV2). Liquidity gate + level freshness.
export { usdVolumeGateTools } from "./runtime/usdVolumeGateDiagnostic.ts";
export { levelFreshnessTools } from "./runtime/levelFreshnessDiagnostic.ts";

// LV3-LV6 — Spicy article extraction. Volume-trend verdict, fake-liquidity
// detector, in-trade volume exhaustion, and margin-of-error scoring.
export { volumeTrendTools } from "./runtime/volumeTrendDiagnostic.ts";
export { fakeLiquidityTools } from "./runtime/fakeLiquidityDiagnostic.ts";
export { volumeExhaustionTools } from "./runtime/volumeExhaustionDiagnostic.ts";
export { marginOfErrorTools } from "./runtime/marginOfErrorDiagnostic.ts";

// LV7-LV8 — Retrospective coaching primitives from Spicy's
// rate-of-learning + reverse-engineered-profitability articles.
// EV-component bottleneck identifier + per-trade execution
// consistency scorer.
export { constraintIdentifierTools } from "./runtime/constraintIdentifierDiagnostic.ts";
export { tradeConsistencyTools } from "./runtime/tradeConsistencyDiagnostic.ts";

// LV9 — Connors-style consecutive-bar streak detector with
// historical-percentile exhaustion verdict + fade direction.
// Distinct from streakCircuitBreaker (loss streak) and
// hotStreakSizer (PnL streak) — this one operates on PRICE bars.
export { streakDetectorTools } from "./runtime/streakDetectorDiagnostic.ts";

// Goal-engineering primitives (GE1-GE3). Drafter + mandate linkage + deferred-actions log.
// Companion to the existing /goal command in src/core/pipeline/goalMode.ts.
export { goalDraftTools } from "./runtime/goalDraftDiagnostic.ts";
export { goalMandateLinkTools } from "./runtime/goalMandateLinkDiagnostic.ts";
export { goalDeferredActionsTools } from "./runtime/goalDeferredActionsDiagnostic.ts";

// ET1 — Strategy economic-thesis capture. Anti-trap primitive: forces explicit
// economic-mechanism articulation before backtest/deployment, with anti-pattern
// detection for data-mining framing. Companion to per-plan recordUserThesis.
export { strategyEdgeThesisTools } from "./runtime/strategyEdgeThesisDiagnostic.ts";

// HR1 — Multi-instrument optimal hedge ratio. Variance-minimizing hedge weights
// for hedging a position X with a basket of K candidates. Generalizes KF1
// (kalmanBeta) from single-instrument to multi-instrument hedging.
export { multiInstrumentHedgeRatioTools } from "./runtime/multiInstrumentHedgeRatioDiagnostic.ts";

// DEC1 — Decision observability. Stamps any structured edit (ACE lesson,
// harness change) with a self-declared prediction at edit-time; later
// verification compares predicted vs realized over a window. Falsifiable-
// contract pattern from AHE.
export { decisionObservabilityTools } from "./runtime/decisionObservabilityDiagnostic.ts";

// PF1 — Pareto frontier tracker. Multi-objective non-dominated set
// computation. Generalizes single-objective best-selection. Pairs with
// DEC1 vector predictions, harnessEvolution multi-objective selection.
export { paretoFrontierTools } from "./runtime/paretoFrontierDiagnostic.ts";
// Trendline detection diagnostic (TL1) — peel-off envelope or OLS best-fit
// trendlines for upper/lower price series. Returns slope/intercept/r²/touches/
// endpoints. Plausible consumers: chartTools VLM overlay, strategyEdgeThesis,
// levelFreshness sloped extension, timeBasedExit, regime slope feature.
export { trendlineDetectionTools } from "./runtime/trendlineDetectionDiagnostic.ts";

// Playbook tools (v0.7)
export { playbookTools } from "./runtime/meta/playbook-tools.ts";

// Playbook backtest tools (v0.7)
export { playbookBacktestTools } from "./strategy/backtest/backtest-tools.ts";

// Runtime tools (v0.7) -- composable strategy runtime
export { runtimeTools } from "./runtime/flow/runtime-tools.ts";

// Regime detection tools (v0.7)
export { regimeTools } from "./market/regime-tools.ts";

// Audit tools (v0.7) -- agent decision traceability
export { auditTools } from "./runtime/meta/audit-tools.ts";

// Advanced tools (Phase 3) -- execution twin, proofs, regime memory
export { advancedTools } from "./runtime/flow/advanced-tools.ts";
export { systematicTools } from "./strategy/systematic-tools.ts";

// Genome tools (v0.75) -- playbook evolution, A/B experiments, mutation suggestions
export { genomeTools } from "./runtime/meta/genome-tools.ts";

// Protocol tools (v0.7) -- playbook protocol validation/export/import/comparison
export { protocolTools } from "../../../core/playbooks/protocol-tools.ts";

// Multi-modal chart tools (image generation and vision analysis)
export { multiModalChartTools } from "../../tools/chartTools.ts";

// Shared context tools for cross-agent memory
export { sharedContextTools } from "../context/shared-context.ts";

// Eval tools for learning from trade outcomes
export { evalTools } from "../../domain/evals/tools.ts";

// Tool metrics wrapper
export { withToolMetrics, withToolsMetrics } from "./wrappers/withMetrics.ts";

// Tool composition utilities
export {
  executeTool,
  createToolChain,
  runChain,
  runParallel,
  runConditional,
  runConditionalChain,
  runFullAnalysis,
  calculateCombinedScore,
  technicalAnalysisChain,
  marketStructureChain,
  type ToolResult,
  type ToolChainStep,
  type ToolChain,
  type ParallelToolSpec,
  type ConditionFn,
} from "./runtime/flow/composition.ts";

// Tool caching utilities
export {
  withCache,
  withDeduplication,
  withCacheAndDeduplication,
  createCachedTool,
  TOOL_CACHE_CONFIG,
  getToolCacheStats,
  clearToolCache,
  pruneToolCache,
  invalidateToolCache,
  type ToolCacheOptions,
  type ToolExecutor as CacheToolExecutor,
} from "./runtime/cache.ts";

// ============================================================================
// Input Validation Utilities
// ============================================================================

export {
  validateToolInput,
  withValidation,
  createValidationRule,
  commonValidationRules,
  TOOL_VALIDATION_CONFIG,
  getToolValidationConfig,
  formatValidationErrors,
  // Validators
  isValidSymbol,
  isValidSymbolOrBase,
  isValidAmount,
  isAmountInRange,
  isValidPercentage,
  isValidTimeframe,
  isValidRiskLevel,
  isValidDateString,
  isPositiveInteger,
  isIntegerInRange,
  // Types
  type ValidationRule,
  type ValidationResult,
  type ToolValidationConfig,
  type ToolExecutor as ValidationToolExecutor,
} from "./runtime/flow/validation.ts";

// ============================================================================
// Timeout Handling Utilities
// ============================================================================

export {
  withTimeout,
  executeWithTimeout,
  TOOL_TIMEOUT_CONFIG,
  getToolTimeoutConfig,
  isTimeoutResult,
  getRemainingTimeout,
  formatTimeoutDuration,
  // Types
  type ToolTimeoutConfig,
  type TimeoutResult,
  type ToolExecutor as TimeoutToolExecutor,
} from "./runtime/rate/timeout.ts";

// ============================================================================
// Error Translation Utilities
// ============================================================================

export {
  translateError,
  translateBinanceError,
  translateNetworkError,
  translateValidationError,
  formatTranslatedError,
  createErrorResponse,
  isBinanceApiError,
  isInsufficientFundsError,
  isRateLimitError,
  isAuthenticationError,
  isRecoverableError,
  // Types
  type BinanceApiError,
  type TranslatedError,
  type ErrorCategory,
} from "./runtime/flow/error-translator.ts";

// ============================================================================
// Rate Limiting Utilities
// ============================================================================

export {
  withRateLimit,
  checkRateLimit,
  recordToolCall as recordRateLimitCall,
  TOOL_RATE_LIMITS,
  getToolRateLimitConfig,
  isRateLimitedResult,
  getToolRateLimitState,
  resetRateLimitState,
  getAllRateLimitStats,
  formatWaitTime,
  // Types
  type ToolRateLimitConfig,
  type RateLimitResult,
  type ToolExecutor as RateLimitToolExecutor,
} from "./runtime/rate/rate-limiter.ts";

// ============================================================================
// Pagination Utilities
// ============================================================================

export {
  paginateResults,
  applyPaginationToResult,
  extractPaginationParams,
  TOOL_PAGINATION_CONFIG,
  getToolPaginationConfig,
  formatPaginationSummary,
  getNextPageParams,
  getPreviousPageParams,
  getPageParams,
  isLastPage,
  isFirstPage,
  calculateTotalPages,
  validatePaginationParams,
  // Types
  type PaginationParams,
  type PaginatedResult,
  type PaginationMetadata,
  type ToolPaginationConfig,
} from "./market/pagination.ts";

// ============================================================================
// Combined Tools Object
// ============================================================================

import { indicatorTools } from "./market/indicators.ts";
import { explainTools } from "./strategy/explain.ts";
import { marketTools } from "./market/market.ts";
import { positionTools } from "./account/positions.ts";
import { schedulerTools } from "./runtime/lifecycle/scheduler.ts";
import { systemTools } from "./runtime/flow/system.ts";
import { earnTools } from "./account/earn.ts";
import { chartTools } from "./market/charts.ts";
import { orderbookTools } from "./market/orderbook.ts";
import { walletTools } from "./trading/wallet.ts";
import { discoveryTools } from "./news/discovery.ts";
import { historyTools } from "./runtime/flow/history.ts";
import { skillsTools } from "./runtime/flow/skillsManagement.ts";
import { investigationTools } from "./runtime/flow/investigationTool.ts";
import { executionDisciplineTools } from "./runtime/flow/executionDiscipline.ts";
import { composabilityTools } from "./runtime/flow/composabilityTool.ts";
import { accountTools } from "./account/account.ts";
import { tradingTools } from "./trading/trading.ts";
import { marketAnalysisTools } from "./market/market-analysis.ts";
import { riskManagementTools } from "./trading/risk-management.ts";
import { strategyTools } from "./strategy/strategies.ts";
import { strategyGenerationTools } from "./strategy/generation/strategy-generation.ts";
import { metricsTools } from "./strategy/metrics.ts";
import { compositionTools } from "./runtime/flow/composition.ts";
import { backtestTools } from "./strategy/backtest/backtest.ts";
import { parallelAnalysisTools } from "./strategy/parallel-analysis.ts";
import { marketDataTools } from "./market/market-data.ts";
import { liquidationIntelligenceTools } from "./trading/liquidation-intelligence.ts";
import { pairAnalysisTools } from "./market/pair-analysis.ts";
import { autonomousTools } from "./runtime/meta/autonomous.ts";
import { baseOnchainTools } from "./onchain/base/base-onchain.ts";
import { agentKitOnchainTools } from "./onchain/agentkit/agentkit-onchain.ts";
import { agentKitDefiTools } from "./onchain/agentkit/agentkit-defi.ts";
import { polkadotKitAssetTools } from "./onchain/polkadotkit/polkadotkit-assets.ts";
import { polkadotKitStakingTools } from "./onchain/polkadotkit/polkadotkit-staking.ts";
import { polkadotKitDefiTools } from "./onchain/polkadotkit/polkadotkit-defi.ts";
import { solanaKitWalletTools } from "./onchain/solanakit/solanakit-wallet.ts";
import { solanaKitTradingTools } from "./onchain/solanakit/solanakit-trading.ts";
import { solanaKitDefiPerpsTools } from "./onchain/solanakit/solanakit-defi-perps.ts";
import { solanaKitDefiLendingTools } from "./onchain/solanakit/solanakit-defi-lending.ts";
import { solanaKitDefiPoolsTools } from "./onchain/solanakit/solanakit-defi-pools.ts";
import { solanaKitDefiBridgeTools } from "./onchain/solanakit/solanakit-defi-bridge.ts";
import { baseSignalTools } from "./onchain/base/base-signals.ts";
import { baseIndexerTools } from "./onchain/base/base-indexers.ts";
import { uniswapDataTools } from "./onchain/dex/uniswap-data.ts";
import { dexSearchTools } from "./news/dex-search.ts";
import { xSocialTools } from "./news/x-social.ts";
import { cdpWebhookTools } from "./onchain/cdp/cdp-webhooks.ts";
import { cdpSqlTools } from "./onchain/cdp/cdp-sql.ts";
import { cdpPolicyTools } from "./onchain/cdp/cdp-policy.ts";
import { cdpOnrampTools } from "./onchain/cdp/cdp-onramp.ts";
import { cdpEvmMultichainTools } from "./onchain/cdp/cdp-evm-multichain.ts";
import { cdpWebhookReceiverTools } from "./onchain/cdp/cdp-webhook-receiver.ts";
import { proactiveModeTools } from "./runtime/flow/proactive-mode.ts";
import { backtestVerdictTools } from "./strategy/backtest/backtest-verdict.ts";
import { finnhubTools } from "./providers/finnhub-tools.ts";
import { finnhubFundamentalsTools } from "./providers/finnhub-fundamentals-tools.ts";
import { finnhubMarketsTools } from "./providers/finnhub-markets-tools.ts";
import { smcPatternTools } from "./market/smc-pattern-tools.ts";
import { calibrationTools } from "./runtime/meta/calibration-tools.ts";
import { skillLoaderTools } from "./runtime/lifecycle/skill-loader.ts";
import { producerHealthTools } from "./runtime/lifecycle/producer-health-tool.ts";
import { defillamaYieldTools } from "./onchain/dex/defillama-yields.ts";
import { newsTools } from "./news/news.ts";
import { stockNewsTools } from "./news/stockNews.ts";
import { strategyRecipeTools } from "./strategy/generation/strategy-recipes.ts";
import { chainlinkStreamsTools } from "./onchain/chainlink/chainlink-streams.ts";
import { chainlinkFeedsTools } from "./onchain/chainlink/chainlink-feeds.ts";
import { chainlinkCCIPTools } from "./onchain/chainlink/chainlink-ccip.ts";
import { synthDataTools } from "./providers/synthdata.ts";
import { agentRailsTools } from "./runtime/meta/agent-rails.ts";
import { positionTrackingTools } from "./account/position-tracking.ts";
import { checkRiskTool } from "./trading/risk-gate.ts";
import { memoryTools } from "./runtime/meta/memory-tools.ts";
import { aceTools } from "./runtime/meta/ace-tools.ts";
import { agentFeedbackTools } from "./runtime/meta/agent-feedback.ts";
import { antiTrapTools } from "./runtime/meta/anti-trap.ts";
import { statusTools } from "./runtime/statusOverview.ts";
import { shadowPlanTools } from "./runtime/shadowPlan.ts";
import { feedbackRatingTools } from "./runtime/feedbackRating.ts";
import { effectiveNTools } from "./runtime/effectiveNDiagnostic.ts";
import { kalmanBetaTools } from "./runtime/kalmanBetaDiagnostic.ts";
import { rangeVolatilityTools } from "./runtime/rangeVolatilityDiagnostic.ts";
import { pcaConcentrationTools } from "./runtime/pcaConcentrationDiagnostic.ts";
import { efficiencyRatioTools } from "./runtime/efficiencyRatioDiagnostic.ts";
import { kaufmanAdaptiveMaTools } from "./runtime/kaufmanAdaptiveMaDiagnostic.ts";
import { marketProfileTools } from "./runtime/marketProfileDiagnostic.ts";
import { tripleScreenTools } from "./runtime/tripleScreenDiagnostic.ts";
import { bootstrapTools } from "./runtime/bootstrapDiagnostic.ts";
import { volScaledSizingTools } from "./runtime/volScaledSizingDiagnostic.ts";
import { directionalEdgeTestTools } from "./runtime/directionalEdgeTestDiagnostic.ts";
import { implementationShortfallTools } from "./runtime/implementationShortfallDiagnostic.ts";
import { efficientTradingFrontierTools } from "./runtime/efficientTradingFrontierDiagnostic.ts";
import { carteaJaimungalSignalTools } from "./runtime/carteaJaimungalSignalDiagnostic.ts";
import { transientImpactTools } from "./runtime/transientImpactDiagnostic.ts";
import { optimalLimitDepthTools } from "./runtime/optimalLimitDepthDiagnostic.ts";
import { optimalPairsTradingTools } from "./runtime/optimalPairsTradingDiagnostic.ts";
import { faeFtaCutTools } from "./runtime/faeFtaCutDiagnostic.ts";
import { timeBasedExitTools } from "./runtime/timeBasedExitDiagnostic.ts";
import { marketBreadthBiasTools } from "./runtime/marketBreadthBiasDiagnostic.ts";
import { hotStreakSizerTools } from "./runtime/hotStreakSizerDiagnostic.ts";
import { revengeTradeGuardTools } from "./runtime/revengeTradeGuardDiagnostic.ts";
import { brierScoreTools } from "./runtime/brierScoreDiagnostic.ts";
import { usdVolumeGateTools } from "./runtime/usdVolumeGateDiagnostic.ts";
import { volumeTrendTools } from "./runtime/volumeTrendDiagnostic.ts";
import { fakeLiquidityTools } from "./runtime/fakeLiquidityDiagnostic.ts";
import { volumeExhaustionTools } from "./runtime/volumeExhaustionDiagnostic.ts";
import { marginOfErrorTools } from "./runtime/marginOfErrorDiagnostic.ts";
import { constraintIdentifierTools } from "./runtime/constraintIdentifierDiagnostic.ts";
import { tradeConsistencyTools } from "./runtime/tradeConsistencyDiagnostic.ts";
import { streakDetectorTools } from "./runtime/streakDetectorDiagnostic.ts";
import { levelFreshnessTools } from "./runtime/levelFreshnessDiagnostic.ts";
import { goalDraftTools } from "./runtime/goalDraftDiagnostic.ts";
import { goalMandateLinkTools } from "./runtime/goalMandateLinkDiagnostic.ts";
import { goalDeferredActionsTools } from "./runtime/goalDeferredActionsDiagnostic.ts";
import { strategyEdgeThesisTools } from "./runtime/strategyEdgeThesisDiagnostic.ts";
import { multiInstrumentHedgeRatioTools } from "./runtime/multiInstrumentHedgeRatioDiagnostic.ts";
import { decisionObservabilityTools } from "./runtime/decisionObservabilityDiagnostic.ts";
import { paretoFrontierTools } from "./runtime/paretoFrontierDiagnostic.ts";
import { trendlineDetectionTools } from "./runtime/trendlineDetectionDiagnostic.ts";
import { playbookTools } from "./runtime/meta/playbook-tools.ts";
import { playbookBacktestTools } from "./strategy/backtest/backtest-tools.ts";
import { runtimeTools } from "./runtime/flow/runtime-tools.ts";
import { regimeTools } from "./market/regime-tools.ts";
import { auditTools } from "./runtime/meta/audit-tools.ts";
import { advancedTools } from "./runtime/flow/advanced-tools.ts";
import { systematicTools } from "./strategy/systematic-tools.ts";
import { genomeTools } from "./runtime/meta/genome-tools.ts";
import { protocolTools } from "../../../core/playbooks/protocol-tools.ts";
import { multiModalChartTools } from "../../tools/chartTools.ts";
import { evalTools } from "../../domain/evals/tools.ts";
import { withSpillAll } from "./wrappers/withSpill.ts";
import { tradingInfraTools } from "./runtime/tradingInfra.ts";
import { venueRoutingTools } from "./trading/venue-routing.ts";

/**
 * All tools combined as a single object for Mastra Agent.
 * Wrapped with withSpillAll() so tool results > 50KB auto-spill to disk.
 */
const _rawAllTools = {
  ...indicatorTools,
  ...explainTools,
  ...marketTools,
  ...positionTools,
  ...schedulerTools,
  ...systemTools,
  ...earnTools,
  ...chartTools,
  ...orderbookTools,
  ...venueRoutingTools,
  ...walletTools,
  ...discoveryTools,
  ...historyTools,
  ...skillsTools,
  ...investigationTools,
  ...executionDisciplineTools,
  ...composabilityTools,
  ...accountTools,
  ...tradingTools,
  ...marketAnalysisTools,
  ...riskManagementTools,
  ...strategyTools,
  ...strategyGenerationTools,
  ...metricsTools,
  ...compositionTools,
  ...backtestTools,
  ...parallelAnalysisTools,
  ...marketDataTools,
  ...liquidationIntelligenceTools,
  ...pairAnalysisTools,
  ...autonomousTools,
  ...baseOnchainTools,
  ...agentKitOnchainTools,
  ...agentKitDefiTools,
  ...polkadotKitAssetTools,
  ...polkadotKitStakingTools,
  ...polkadotKitDefiTools,
  ...solanaKitWalletTools,
  ...solanaKitTradingTools,
  ...solanaKitDefiPerpsTools,
  ...solanaKitDefiLendingTools,
  ...solanaKitDefiPoolsTools,
  ...solanaKitDefiBridgeTools,
  ...baseSignalTools,
  ...baseIndexerTools,
  ...uniswapDataTools,
  ...dexSearchTools,
  ...xSocialTools,
  ...cdpWebhookTools,
  ...cdpSqlTools,
  ...cdpPolicyTools,
  ...cdpOnrampTools,
  ...cdpEvmMultichainTools,
  ...cdpWebhookReceiverTools,
  ...proactiveModeTools,
  ...backtestVerdictTools,
  ...finnhubTools,
  ...finnhubFundamentalsTools,
  ...finnhubMarketsTools,
  ...smcPatternTools,
  ...calibrationTools,
  ...skillLoaderTools,
  ...producerHealthTools,
  ...defillamaYieldTools,
  ...newsTools,
  ...stockNewsTools,
  ...strategyRecipeTools,
  ...chainlinkStreamsTools,
  ...chainlinkFeedsTools,
  ...chainlinkCCIPTools,
  ...synthDataTools,
  ...agentRailsTools,
  ...multiModalChartTools,
  ...evalTools,
  ...positionTrackingTools,
  check_risk: checkRiskTool,
  ...memoryTools,
  ...aceTools,
  ...agentFeedbackTools,
  ...antiTrapTools,
  ...statusTools,
  ...shadowPlanTools,
  ...feedbackRatingTools,
  ...effectiveNTools,
  ...kalmanBetaTools,
  ...rangeVolatilityTools,
  ...pcaConcentrationTools,
  ...efficiencyRatioTools,
  ...kaufmanAdaptiveMaTools,
  ...marketProfileTools,
  ...tripleScreenTools,
  ...bootstrapTools,
  ...volScaledSizingTools,
  ...directionalEdgeTestTools,
  ...implementationShortfallTools,
  ...efficientTradingFrontierTools,
  ...carteaJaimungalSignalTools,
  ...transientImpactTools,
  ...optimalLimitDepthTools,
  ...optimalPairsTradingTools,
  ...faeFtaCutTools,
  ...timeBasedExitTools,
  ...marketBreadthBiasTools,
  ...hotStreakSizerTools,
  ...revengeTradeGuardTools,
  ...brierScoreTools,
  ...usdVolumeGateTools,
  ...volumeTrendTools,
  ...fakeLiquidityTools,
  ...volumeExhaustionTools,
  ...marginOfErrorTools,
  ...constraintIdentifierTools,
  ...tradeConsistencyTools,
  ...streakDetectorTools,
  ...levelFreshnessTools,
  ...goalDraftTools,
  ...goalMandateLinkTools,
  ...goalDeferredActionsTools,
  ...strategyEdgeThesisTools,
  ...multiInstrumentHedgeRatioTools,
  ...decisionObservabilityTools,
  ...paretoFrontierTools,
  ...trendlineDetectionTools,
  ...playbookTools,
  ...playbookBacktestTools,
  ...runtimeTools,
  ...regimeTools,
  ...auditTools,
  ...advancedTools,
  ...systematicTools,
  ...genomeTools,
  ...protocolTools,
  ...tradingInfraTools,
};

/** Tool bundle wrapped with disk-spill for results > 50KB. */
export const allTools = withSpillAll(_rawAllTools);

/**
 * Tool counts by category (useful for debugging)
 */
export const toolCounts = {
  indicators: Object.keys(indicatorTools).length,
  explain: Object.keys(explainTools).length,
  market: Object.keys(marketTools).length,
  positions: Object.keys(positionTools).length,
  scheduler: Object.keys(schedulerTools).length,
  system: Object.keys(systemTools).length,
  earn: Object.keys(earnTools).length,
  charts: Object.keys(chartTools).length,
  orderbook: Object.keys(orderbookTools).length,
  wallet: Object.keys(walletTools).length,
  discovery: Object.keys(discoveryTools).length,
  history: Object.keys(historyTools).length,
  skills: Object.keys(skillsTools).length,
  investigation: Object.keys(investigationTools).length,
  executionDiscipline: Object.keys(executionDisciplineTools).length,
  composability: Object.keys(composabilityTools).length,
  account: Object.keys(accountTools).length,
  trading: Object.keys(tradingTools).length,
  marketAnalysis: Object.keys(marketAnalysisTools).length,
  riskManagement: Object.keys(riskManagementTools).length,
  strategies: Object.keys(strategyTools).length,
  strategyGeneration: Object.keys(strategyGenerationTools).length,
  metrics: Object.keys(metricsTools).length,
  composition: Object.keys(compositionTools).length,
  backtest: Object.keys(backtestTools).length,
  parallelAnalysis: Object.keys(parallelAnalysisTools).length,
  marketData: Object.keys(marketDataTools).length,
  liquidationIntelligence: Object.keys(liquidationIntelligenceTools).length,
  pairAnalysis: Object.keys(pairAnalysisTools).length,
  autonomous: Object.keys(autonomousTools).length,
  baseOnchain: Object.keys(baseOnchainTools).length,
  agentKitOnchain: Object.keys(agentKitOnchainTools).length,
  agentKitDefi: Object.keys(agentKitDefiTools).length,
  polkadotKitAssets: Object.keys(polkadotKitAssetTools).length,
  polkadotKitStaking: Object.keys(polkadotKitStakingTools).length,
  polkadotKitDefi: Object.keys(polkadotKitDefiTools).length,
  solanaKitWallet: Object.keys(solanaKitWalletTools).length,
  solanaKitTrading: Object.keys(solanaKitTradingTools).length,
  solanaKitDefiPerps: Object.keys(solanaKitDefiPerpsTools).length,
  solanaKitDefiLending: Object.keys(solanaKitDefiLendingTools).length,
  solanaKitDefiPools: Object.keys(solanaKitDefiPoolsTools).length,
  solanaKitDefiBridge: Object.keys(solanaKitDefiBridgeTools).length,
  baseSignals: Object.keys(baseSignalTools).length,
  baseIndexers: Object.keys(baseIndexerTools).length,
  uniswapData: Object.keys(uniswapDataTools).length,
  dexSearch: Object.keys(dexSearchTools).length,
  xSocial: Object.keys(xSocialTools).length,
  cdpWebhooks: Object.keys(cdpWebhookTools).length,
  cdpSql: Object.keys(cdpSqlTools).length,
  cdpPolicy: Object.keys(cdpPolicyTools).length,
  cdpOnramp: Object.keys(cdpOnrampTools).length,
  cdpEvmMultichain: Object.keys(cdpEvmMultichainTools).length,
  cdpWebhookReceiver: Object.keys(cdpWebhookReceiverTools).length,
  proactiveMode: Object.keys(proactiveModeTools).length,
  backtestVerdict: Object.keys(backtestVerdictTools).length,
  finnhub: Object.keys(finnhubTools).length,
  finnhubFundamentals: Object.keys(finnhubFundamentalsTools).length,
  finnhubMarkets: Object.keys(finnhubMarketsTools).length,
  smcPattern: Object.keys(smcPatternTools).length,
  calibration: Object.keys(calibrationTools).length,
  skillLoader: Object.keys(skillLoaderTools).length,
  producerHealth: Object.keys(producerHealthTools).length,
  defillamaYields: Object.keys(defillamaYieldTools).length,
  news: Object.keys(newsTools).length,
  stockNews: Object.keys(stockNewsTools).length,
  strategyRecipes: Object.keys(strategyRecipeTools).length,
  chainlinkStreams: Object.keys(chainlinkStreamsTools).length,
  chainlinkFeeds: Object.keys(chainlinkFeedsTools).length,
  chainlinkCCIP: Object.keys(chainlinkCCIPTools).length,
  synthData: Object.keys(synthDataTools).length,
  agentRails: Object.keys(agentRailsTools).length,
  multiModalCharts: Object.keys(multiModalChartTools).length,
  evals: Object.keys(evalTools).length,
  positionTracking: Object.keys(positionTrackingTools).length,
  riskGate: 1, // checkRiskTool
  memory: Object.keys(memoryTools).length,
  ace: Object.keys(aceTools).length,
  agentFeedback: Object.keys(agentFeedbackTools).length,
  playbook: Object.keys(playbookTools).length,
  playbookBacktest: Object.keys(playbookBacktestTools).length,
  runtime: Object.keys(runtimeTools).length,
  regime: Object.keys(regimeTools).length,
  audit: Object.keys(auditTools).length,
  advanced: Object.keys(advancedTools).length,
  systematic: Object.keys(systematicTools).length,
  genome: Object.keys(genomeTools).length,
  protocol: Object.keys(protocolTools).length,
  total: Object.keys(allTools).length,
};

// ============================================================================
// Enhanced Tool Wrapper
// ============================================================================

import type { MastraExecutionContext } from "./types.ts";
import { withValidation, TOOL_VALIDATION_CONFIG } from "./runtime/flow/validation.ts";
import { withTimeout, TOOL_TIMEOUT_CONFIG } from "./runtime/rate/timeout.ts";
import { withRateLimit, TOOL_RATE_LIMITS } from "./runtime/rate/rate-limiter.ts";
import { translateError, createErrorResponse } from "./runtime/flow/error-translator.ts";

/**
 * Tool executor function signature
 */
type ToolExecutor<TInput, TOutput> = (
  input: TInput,
  context?: MastraExecutionContext
) => Promise<TOutput>;

/**
 * Enhanced wrapper options
 */
export interface EnhancedToolOptions {
  /** Enable input validation (default: true if config exists) */
  enableValidation?: boolean;
  /** Enable timeout handling (default: true if config exists) */
  enableTimeout?: boolean;
  /** Enable rate limiting (default: true if config exists) */
  enableRateLimit?: boolean;
  /** Enable error translation (default: true) */
  enableErrorTranslation?: boolean;
}

/**
 * Wrap a tool executor with all enhancements: validation, timeout, rate limiting, and error translation
 *
 * This is the recommended way to wrap tool executors for production use.
 * It applies wrappers in the correct order:
 * 1. Input validation (first, to fail fast on bad input)
 * 2. Rate limiting (second, to prevent unnecessary work)
 * 3. Timeout handling (third, to prevent long-running operations)
 * 4. Error translation (wraps around all, to translate any errors)
 *
 * @param toolName - Name of the tool (for config lookup)
 * @param executor - The original tool executor
 * @param options - Optional configuration overrides
 * @returns Enhanced executor with all wrappers applied
 *
 * @example
 * ```typescript
 * const enhancedExecutor = withEnhancements(
 *   "scan_market",
 *   originalExecutor,
 *   { enableRateLimit: true }
 * );
 * ```
 */
export function withEnhancements<TInput extends Record<string, unknown>, TOutput>(
  toolName: string,
  executor: ToolExecutor<TInput, TOutput>,
  options: EnhancedToolOptions = {}
): ToolExecutor<TInput, TOutput | { error: string; [key: string]: unknown }> {
  const {
    enableValidation = toolName in TOOL_VALIDATION_CONFIG,
    enableTimeout = toolName in TOOL_TIMEOUT_CONFIG,
    enableRateLimit = toolName in TOOL_RATE_LIMITS,
    enableErrorTranslation = true,
  } = options;

  // Start with the original executor
  let enhanced: ToolExecutor<TInput, TOutput | { error: string; [key: string]: unknown }> = executor;

  // Apply timeout handling (innermost wrapper that affects execution)
  if (enableTimeout) {
    enhanced = withTimeout(toolName, enhanced) as typeof enhanced;
  }

  // Apply rate limiting
  if (enableRateLimit) {
    enhanced = withRateLimit(toolName, enhanced) as typeof enhanced;
  }

  // Apply validation (fails fast, before other work)
  if (enableValidation) {
    const validationConfig = TOOL_VALIDATION_CONFIG[toolName];
    if (validationConfig) {
      enhanced = withValidation(enhanced, validationConfig.rules) as typeof enhanced;
    }
  }

  // Apply error translation (outermost wrapper)
  if (enableErrorTranslation) {
    const withErrorTranslation = enhanced;
    enhanced = async function errorTranslatedExecutor(
      input: TInput,
      context?: MastraExecutionContext
    ): Promise<TOutput | { error: string; [key: string]: unknown }> {
      try {
        return await withErrorTranslation(input, context);
      } catch (error) {
        const translated = createErrorResponse(error);
        return translated;
      }
    };
  }

  return enhanced;
}

// ============================================================================
// Tool Categories for Selective Enhancement
// ============================================================================

/**
 * Tool categories that should have specific enhancements enabled
 */
export const TOOL_ENHANCEMENT_CATEGORIES = {
  /** Tools that should have timeout handling */
  withTimeout: [
    "run_backtest",
    "optimize_strategy",
    "compare_backtests",
    "scan_market",
    "analyze_coin",
    "scan_breakouts",
    "find_consolidating_coins",
    "detect_whale_activity",
    "scan_for_strategies",
    "get_technical_analysis",
    "execute_plan",
    "close_trade",
  ],

  /** Tools that should have rate limiting */
  withRateLimit: [
    "scan_market",
    "scan_breakouts",
    "find_consolidating_coins",
    "detect_whale_activity",
    "scan_for_strategies",
    "get_trade_history",
    "get_transfer_history",
    "get_historical_opportunities",
    "run_backtest",
    "optimize_strategy",
  ],

  /** Tools that should have input validation */
  withValidation: [
    "scan_market",
    "analyze_coin",
    "create_plan",
    "create_grid_plan",
    "run_backtest",
    "optimize_strategy",
    "compare_backtests",
    "get_trade_history",
    "get_historical_opportunities",
    "get_rsi",
    "get_macd",
    "get_bollinger_bands",
    "get_technical_analysis",
  ],
} as const;

/**
 * Check if a tool should have a specific enhancement enabled
 *
 * @param toolName - Name of the tool
 * @param enhancement - Enhancement type
 * @returns Whether the enhancement should be enabled
 */
export function shouldEnhanceTool(
  toolName: string,
  enhancement: keyof typeof TOOL_ENHANCEMENT_CATEGORIES
): boolean {
  const category = TOOL_ENHANCEMENT_CATEGORIES[enhancement] as readonly string[];
  return category.includes(toolName);
}
