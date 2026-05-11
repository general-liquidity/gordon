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
export { askUserTools, askUserTool } from "./askUser.ts";
export { indicatorTools } from "./indicators.ts";
export { explainTools } from "./explain.ts";
export { marketTools } from "./market.ts";
export { positionTools } from "./positions.ts";
export { schedulerTools } from "./scheduler.ts";
export { systemTools } from "./system.ts";
export { earnTools } from "./earn.ts";
export { chartTools } from "./charts.ts";
export { orderbookTools } from "./orderbook.ts";
export { walletTools } from "./wallet.ts";
export { discoveryTools } from "./discovery.ts";
export { historyTools } from "./history.ts";
export { accountTools } from "./account.ts";
export { tradingTools } from "./trading.ts";
export { marketAnalysisTools } from "./market-analysis.ts";
export { riskManagementTools } from "./risk-management.ts";
export { strategyTools } from "./strategies.ts";
export { strategyGenerationTools } from "./strategy-generation.ts";
export { metricsTools } from "./metrics.ts";
export { compositionTools } from "./composition.ts";
export { backtestTools } from "./backtest.ts";
export { parallelAnalysisTools } from "./parallel-analysis.ts";
export { marketDataTools } from "./market-data.ts";
export { liquidationIntelligenceTools } from "./liquidation-intelligence.ts";
export { pairAnalysisTools } from "./pair-analysis.ts";
export { autonomousTools } from "./autonomous.ts";
export { baseOnchainTools } from "./base-onchain.ts";
export { agentKitOnchainTools } from "./agentkit-onchain.ts";
export { agentKitDefiTools } from "./agentkit-defi.ts";
export { polkadotKitAssetTools } from "./polkadotkit-assets.ts";
export { polkadotKitStakingTools } from "./polkadotkit-staking.ts";
export { polkadotKitDefiTools } from "./polkadotkit-defi.ts";
export { solanaKitWalletTools } from "./solanakit-wallet.ts";
export { solanaKitTradingTools } from "./solanakit-trading.ts";
export { solanaKitDefiPerpsTools } from "./solanakit-defi-perps.ts";
export { solanaKitDefiLendingTools } from "./solanakit-defi-lending.ts";
export { solanaKitDefiPoolsTools } from "./solanakit-defi-pools.ts";
export { solanaKitDefiBridgeTools } from "./solanakit-defi-bridge.ts";
export { baseSignalTools } from "./base-signals.ts";
export { baseIndexerTools } from "./base-indexers.ts";
export { uniswapDataTools } from "./uniswap-data.ts";
export { dexSearchTools } from "./dex-search.ts";
export { xSocialTools } from "./x-social.ts";
export { cdpWebhookTools } from "./cdp-webhooks.ts";
export { cdpSqlTools } from "./cdp-sql.ts";
export { cdpPolicyTools } from "./cdp-policy.ts";
export { cdpOnrampTools } from "./cdp-onramp.ts";
export { cdpEvmMultichainTools } from "./cdp-evm-multichain.ts";
export { cdpWebhookReceiverTools } from "./cdp-webhook-receiver.ts";
export { proactiveModeTools } from "./proactive-mode.ts";
export { backtestVerdictTools } from "./backtest-verdict.ts";
export { finnhubTools } from "./finnhub-tools.ts";
export { finnhubFundamentalsTools } from "./finnhub-fundamentals-tools.ts";
export { finnhubMarketsTools } from "./finnhub-markets-tools.ts";
export { smcPatternTools } from "./smc-pattern-tools.ts";
export { calibrationTools } from "./calibration-tools.ts";
export { skillLoaderTools } from "./skill-loader.ts";
export { producerHealthTools } from "./producer-health-tool.ts";
export { defillamaYieldTools } from "./defillama-yields.ts";
export { newsTools } from "./news.ts";
export { stockNewsTools } from "./stockNews.ts";
export { strategyRecipeTools } from "./strategy-recipes.ts";
export { chainlinkStreamsTools } from "./chainlink-streams.ts";
export { chainlinkFeedsTools } from "./chainlink-feeds.ts";
export { chainlinkCCIPTools } from "./chainlink-ccip.ts";
export { synthDataTools } from "./synthdata.ts";
export { agentRailsTools } from "./agent-rails.ts";

// Position tracking tools (v0.7)
export { positionTrackingTools } from "./position-tracking.ts";

// Risk gate tools (v0.7)
export { checkRiskTool, evaluateOrderRisk } from "./risk-gate.ts";

// Memory tools (v0.7)
export { memoryTools } from "./memory-tools.ts";

// ACE (Agentic Context Engineering) tools
export { aceTools } from "./ace-tools.ts";

// Playbook tools (v0.7)
export { playbookTools } from "./playbook-tools.ts";

// Playbook backtest tools (v0.7)
export { playbookBacktestTools } from "./backtest-tools.ts";

// Runtime tools (v0.7) -- composable strategy runtime
export { runtimeTools } from "./runtime-tools.ts";

// Regime detection tools (v0.7)
export { regimeTools } from "./regime-tools.ts";

// Audit tools (v0.7) -- agent decision traceability
export { auditTools } from "./audit-tools.ts";

// Advanced tools (Phase 3) -- execution twin, proofs, regime memory
export { advancedTools } from "./advanced-tools.ts";
export { systematicTools } from "./systematic-tools.ts";

// Genome tools (v0.75) -- playbook evolution, A/B experiments, mutation suggestions
export { genomeTools } from "./genome-tools.ts";

// Protocol tools (v0.7) -- playbook protocol validation/export/import/comparison
export { protocolTools } from "../../../core/playbooks/protocol-tools.ts";

// Multi-modal chart tools (image generation and vision analysis)
export { multiModalChartTools } from "../../tools/chartTools.ts";

// Shared context tools for cross-agent memory
export { sharedContextTools } from "../shared-context.ts";

// Eval tools for learning from trade outcomes
export { evalTools } from "../../domain/evals/tools.ts";

// Tool metrics wrapper
export { withToolMetrics, withToolsMetrics } from "./withMetrics.ts";

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
} from "./composition.ts";

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
} from "./cache.ts";

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
} from "./validation.ts";

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
} from "./timeout.ts";

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
} from "./error-translator.ts";

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
} from "./rate-limiter.ts";

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
} from "./pagination.ts";

// ============================================================================
// Combined Tools Object
// ============================================================================

import { indicatorTools } from "./indicators.ts";
import { explainTools } from "./explain.ts";
import { marketTools } from "./market.ts";
import { positionTools } from "./positions.ts";
import { schedulerTools } from "./scheduler.ts";
import { systemTools } from "./system.ts";
import { earnTools } from "./earn.ts";
import { chartTools } from "./charts.ts";
import { orderbookTools } from "./orderbook.ts";
import { walletTools } from "./wallet.ts";
import { discoveryTools } from "./discovery.ts";
import { historyTools } from "./history.ts";
import { accountTools } from "./account.ts";
import { tradingTools } from "./trading.ts";
import { marketAnalysisTools } from "./market-analysis.ts";
import { riskManagementTools } from "./risk-management.ts";
import { strategyTools } from "./strategies.ts";
import { strategyGenerationTools } from "./strategy-generation.ts";
import { metricsTools } from "./metrics.ts";
import { compositionTools } from "./composition.ts";
import { backtestTools } from "./backtest.ts";
import { parallelAnalysisTools } from "./parallel-analysis.ts";
import { marketDataTools } from "./market-data.ts";
import { liquidationIntelligenceTools } from "./liquidation-intelligence.ts";
import { pairAnalysisTools } from "./pair-analysis.ts";
import { autonomousTools } from "./autonomous.ts";
import { baseOnchainTools } from "./base-onchain.ts";
import { agentKitOnchainTools } from "./agentkit-onchain.ts";
import { agentKitDefiTools } from "./agentkit-defi.ts";
import { polkadotKitAssetTools } from "./polkadotkit-assets.ts";
import { polkadotKitStakingTools } from "./polkadotkit-staking.ts";
import { polkadotKitDefiTools } from "./polkadotkit-defi.ts";
import { solanaKitWalletTools } from "./solanakit-wallet.ts";
import { solanaKitTradingTools } from "./solanakit-trading.ts";
import { solanaKitDefiPerpsTools } from "./solanakit-defi-perps.ts";
import { solanaKitDefiLendingTools } from "./solanakit-defi-lending.ts";
import { solanaKitDefiPoolsTools } from "./solanakit-defi-pools.ts";
import { solanaKitDefiBridgeTools } from "./solanakit-defi-bridge.ts";
import { baseSignalTools } from "./base-signals.ts";
import { baseIndexerTools } from "./base-indexers.ts";
import { uniswapDataTools } from "./uniswap-data.ts";
import { dexSearchTools } from "./dex-search.ts";
import { xSocialTools } from "./x-social.ts";
import { cdpWebhookTools } from "./cdp-webhooks.ts";
import { cdpSqlTools } from "./cdp-sql.ts";
import { cdpPolicyTools } from "./cdp-policy.ts";
import { cdpOnrampTools } from "./cdp-onramp.ts";
import { cdpEvmMultichainTools } from "./cdp-evm-multichain.ts";
import { cdpWebhookReceiverTools } from "./cdp-webhook-receiver.ts";
import { proactiveModeTools } from "./proactive-mode.ts";
import { backtestVerdictTools } from "./backtest-verdict.ts";
import { finnhubTools } from "./finnhub-tools.ts";
import { finnhubFundamentalsTools } from "./finnhub-fundamentals-tools.ts";
import { finnhubMarketsTools } from "./finnhub-markets-tools.ts";
import { smcPatternTools } from "./smc-pattern-tools.ts";
import { calibrationTools } from "./calibration-tools.ts";
import { skillLoaderTools } from "./skill-loader.ts";
import { producerHealthTools } from "./producer-health-tool.ts";
import { defillamaYieldTools } from "./defillama-yields.ts";
import { newsTools } from "./news.ts";
import { stockNewsTools } from "./stockNews.ts";
import { strategyRecipeTools } from "./strategy-recipes.ts";
import { chainlinkStreamsTools } from "./chainlink-streams.ts";
import { chainlinkFeedsTools } from "./chainlink-feeds.ts";
import { chainlinkCCIPTools } from "./chainlink-ccip.ts";
import { synthDataTools } from "./synthdata.ts";
import { agentRailsTools } from "./agent-rails.ts";
import { positionTrackingTools } from "./position-tracking.ts";
import { checkRiskTool } from "./risk-gate.ts";
import { memoryTools } from "./memory-tools.ts";
import { aceTools } from "./ace-tools.ts";
import { playbookTools } from "./playbook-tools.ts";
import { playbookBacktestTools } from "./backtest-tools.ts";
import { runtimeTools } from "./runtime-tools.ts";
import { regimeTools } from "./regime-tools.ts";
import { auditTools } from "./audit-tools.ts";
import { advancedTools } from "./advanced-tools.ts";
import { systematicTools } from "./systematic-tools.ts";
import { genomeTools } from "./genome-tools.ts";
import { protocolTools } from "../../../core/playbooks/protocol-tools.ts";
import { multiModalChartTools } from "../../tools/chartTools.ts";
import { evalTools } from "../../domain/evals/tools.ts";
import { withSpillAll } from "./withSpill.ts";
import { tradingInfraTools } from "./tradingInfra.ts";
import { venueRoutingTools } from "./venue-routing.ts";

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
import { withValidation, TOOL_VALIDATION_CONFIG } from "./validation.ts";
import { withTimeout, TOOL_TIMEOUT_CONFIG } from "./timeout.ts";
import { withRateLimit, TOOL_RATE_LIMITS } from "./rate-limiter.ts";
import { translateError, createErrorResponse } from "./error-translator.ts";

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
