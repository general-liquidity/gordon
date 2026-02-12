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

// Multi-modal chart tools (image generation and vision analysis)
export { multiModalChartTools } from "../../tools/chartTools.ts";

// Shared context tools for cross-agent memory
export { sharedContextTools } from "../shared-context.ts";

// Eval tools for learning from trade outcomes
export { evalTools } from "../../evals/tools.ts";

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
import { multiModalChartTools } from "../../tools/chartTools.ts";
import { evalTools } from "../../evals/tools.ts";

/**
 * All tools combined as a single object for Mastra Agent
 */
export const allTools = {
  ...indicatorTools,
  ...explainTools,
  ...marketTools,
  ...positionTools,
  ...schedulerTools,
  ...systemTools,
  ...earnTools,
  ...chartTools,
  ...orderbookTools,
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
  ...multiModalChartTools,
  ...evalTools,
};

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
  multiModalCharts: Object.keys(multiModalChartTools).length,
  evals: Object.keys(evalTools).length,
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
