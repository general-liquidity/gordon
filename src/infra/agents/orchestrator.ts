/**
 * Gordon Orchestrator
 * Main agent that coordinates all specialized agents via Mastra
 *
 * SOTA Features Implemented:
 * - Streaming responses with real-time text deltas
 * - Agent Network for automatic multi-agent routing
 * - OpenTelemetry tracing integration
 */

import { RequestContext } from "@mastra/core/request-context";

import { gordonAgent } from "./agents.ts";
import { createModuleLogger } from "../logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import { checkInputGuardrails, checkOutputGuardrails, checkToolAccess } from "./middleware/index.ts";
import {
  initializeTracing as initTracingModule,
  buildTracingOptions,
  isTracingEnabled,
  getTracingConfig,
  recordRequest,
  recordNetworkRouting,
  recordError,
  recordAgentCall,
  enforceRateLimit,
  type SpanContext,
  type RateLimitResult,
} from "../observability/index.ts";
import { auditLog } from "../audit/index.ts";
import { checkPermissionsOnInit } from "../binance/permissions.ts";
import type { GordonContext } from "./types.ts";
import {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  type SummarizerConfig,
  type SummarizationResult,
} from "../memory/index.ts";
import type { Message } from "../llm/types.ts";
import {
  type StreamWriter,
  type StreamingResult,
  type StreamChunk,
  createStartChunk,
  createChunk,
  createEndChunk,
  createErrorChunk,
} from "./streamWriter.ts";

// ============================================================================
// Error Recovery Types & Configuration
// ============================================================================

/**
 * Fallback configuration for an agent
 */
export interface AgentFallbackConfig {
  /** The primary agent to try first */
  primaryAgent: string;
  /** List of fallback agents/tools to try if primary fails */
  fallbacks: Array<{
    /** Name of the fallback agent or tool */
    name: string;
    /** Type: 'agent' for another agent, 'tool' for a basic tool, 'cache' for cached results */
    type: "agent" | "tool" | "cache";
    /** Optional condition to check before using this fallback */
    condition?: (error: Error) => boolean;
  }>;
  /** Maximum retry attempts with exponential backoff */
  maxRetries: number;
  /** Base delay in ms for exponential backoff */
  baseDelayMs: number;
  /** Whether to use cached results on failure */
  useCacheOnFailure: boolean;
}

/**
 * Fallback chain type mapping agent names to their fallback configurations
 */
export type AgentFallbackChain = Record<string, AgentFallbackConfig>;

/**
 * Default fallback chain configuration for Gordon agents
 */
export const DEFAULT_FALLBACK_CHAIN: AgentFallbackChain = {
  Analyst: {
    primaryAgent: "Analyst",
    fallbacks: [
      { name: "get_technical_analysis", type: "tool" },
      { name: "get_rsi", type: "tool" },
    ],
    maxRetries: 3,
    baseDelayMs: 1000,
    useCacheOnFailure: true,
  },
  Backtester: {
    primaryAgent: "Backtester",
    fallbacks: [
      { name: "backtest_cache", type: "cache" },
    ],
    maxRetries: 2,
    baseDelayMs: 2000,
    useCacheOnFailure: true,
  },
  Scanner: {
    primaryAgent: "Scanner",
    fallbacks: [
      { name: "scan_market", type: "tool" },
    ],
    maxRetries: 3,
    baseDelayMs: 1000,
    useCacheOnFailure: false,
  },
  Planner: {
    primaryAgent: "Planner",
    fallbacks: [],
    maxRetries: 2,
    baseDelayMs: 1000,
    useCacheOnFailure: false,
  },
  Executor: {
    primaryAgent: "Executor",
    fallbacks: [],
    maxRetries: 1, // Be conservative with execution
    baseDelayMs: 500,
    useCacheOnFailure: false,
  },
  Monitor: {
    primaryAgent: "Monitor",
    fallbacks: [
      { name: "check_positions", type: "tool" },
    ],
    maxRetries: 3,
    baseDelayMs: 1000,
    useCacheOnFailure: true,
  },
};

/**
 * Check if an error is transient and should be retried
 */
function isTransientError(error: Error): boolean {
  const transientPatterns = [
    /timeout/i,
    /rate.?limit/i,
    /too.?many.?requests/i,
    /503/,
    /502/,
    /504/,
    /network/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /temporarily/i,
    /retry/i,
    /overloaded/i,
  ];

  return transientPatterns.some((pattern) => pattern.test(error.message));
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number, baseDelayMs: number): number {
  // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs * 0.5;
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

// ============================================================================
// Backtest Cache (Simple in-memory cache for fallback)
// ============================================================================

interface CachedBacktestResult {
  key: string;
  result: unknown;
  timestamp: number;
  ttlMs: number;
}

const backtestCache: Map<string, CachedBacktestResult> = new Map();
const BACKTEST_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Store a backtest result in cache
 */
export function cacheBacktestResult(key: string, result: unknown): void {
  backtestCache.set(key, {
    key,
    result,
    timestamp: Date.now(),
    ttlMs: BACKTEST_CACHE_TTL_MS,
  });

  // Prune old entries if cache gets too large
  if (backtestCache.size > 100) {
    const now = Date.now();
    for (const [k, v] of backtestCache.entries()) {
      if (now - v.timestamp > v.ttlMs) {
        backtestCache.delete(k);
      }
    }
  }

  logger.debug("Cached backtest result", { key });
}

/**
 * Get a cached backtest result
 */
export function getCachedBacktestResult(key: string): unknown | null {
  const cached = backtestCache.get(key);
  if (!cached) return null;

  // Check if still valid
  if (Date.now() - cached.timestamp > cached.ttlMs) {
    backtestCache.delete(key);
    return null;
  }

  logger.debug("Retrieved cached backtest result", { key });
  return cached.result;
}

/**
 * Generate a cache key for backtest parameters
 */
export function generateBacktestCacheKey(
  symbol: string,
  strategyId: string,
  timeframe: string,
  days: number
): string {
  return `backtest:${symbol}:${strategyId}:${timeframe}:${days}`;
}

const logger = createModuleLogger("orchestrator");

// ============================================================================
// Conversation Summarization
// ============================================================================

/**
 * Options for message processing with summarization support
 */
export interface ProcessingOptions {
  /**
   * Enable conversation summarization when message count exceeds threshold
   * @default false
   */
  enableSummarization?: boolean;

  /**
   * Custom summarizer configuration (overrides defaults)
   */
  summarizerConfig?: Partial<SummarizerConfig>;

  /**
   * Existing conversation history to potentially summarize
   * If provided, will be checked for summarization before processing
   */
  conversationHistory?: Message[];
}

/**
 * Extended result including summarization info
 */
export interface ProcessingResultWithSummarization {
  /** The agent's response */
  response: string;
  /** Token usage statistics */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Summarization result if summarization was performed */
  summarization?: SummarizationResult;
}

// Singleton summarizer instance (lazy initialized)
let _summarizer: ConversationSummarizer | null = null;

/**
 * Get or create the singleton summarizer instance
 */
function getSummarizer(context: GordonContext): ConversationSummarizer {
  if (!_summarizer) {
    // Create summarizer with config from GordonConfig if available
    const summarizerConfig = context.config.memoryConfig
      ? createSummarizerConfigFromMemoryConfig(context.config.memoryConfig)
      : {};

    _summarizer = createSummarizer(context.llm, summarizerConfig);
    logger.debug("Created summarizer instance", { config: summarizerConfig });
  }
  return _summarizer;
}

/**
 * Reset the summarizer instance (for testing or reconfiguration)
 */
export function resetSummarizer(): void {
  _summarizer = null;
  logger.debug("Summarizer instance reset");
}

/**
 * Summarize conversation history if needed
 *
 * @param context - Gordon context with LLM client
 * @param messages - Conversation history to potentially summarize
 * @param options - Processing options including custom summarizer config
 * @returns SummarizationResult with original or summarized messages
 */
export async function summarizeIfNeeded(
  context: GordonContext,
  messages: Message[],
  options?: ProcessingOptions
): Promise<SummarizationResult> {
  // Check if summarization is enabled
  if (!options?.enableSummarization) {
    return {
      summarized: false,
      messages,
      messagesSummarized: 0,
    };
  }

  const summarizer = getSummarizer(context);

  // Apply custom config if provided
  if (options.summarizerConfig) {
    summarizer.updateConfig(options.summarizerConfig);
  }

  // Check if summarization is needed and perform it
  if (summarizer.shouldSummarize(messages)) {
    logger.info("Summarization triggered", {
      messageCount: messages.length,
      threshold: summarizer.getConfig().messageThreshold,
    });

    const result = await summarizer.summarize(messages);

    if (result.summarized) {
      // Emit event for tracking
      await emitEvent("memory:summarized", {
        originalCount: messages.length,
        newCount: result.messages.length,
        summarizedCount: result.messagesSummarized,
      });
    }

    return result;
  }

  return {
    summarized: false,
    messages,
    messagesSummarized: 0,
  };
}

/**
 * Check if conversation history needs summarization
 */
export function needsSummarization(
  context: GordonContext,
  messages: Message[]
): boolean {
  const summarizer = getSummarizer(context);
  return summarizer.shouldSummarize(messages);
}

/**
 * Get summarization statistics for current conversation
 */
export function getSummarizationStats(
  context: GordonContext,
  messages: Message[]
): {
  messageCount: number;
  threshold: number;
  needsSummarization: boolean;
  messagesToSummarize: number;
  messagesToKeep: number;
} {
  const summarizer = getSummarizer(context);
  const config = summarizer.getConfig();
  const shouldSummarize = summarizer.shouldSummarize(messages);

  return {
    messageCount: messages.length,
    threshold: config.messageThreshold,
    needsSummarization: shouldSummarize,
    messagesToSummarize: shouldSummarize ? summarizer.getMessagesToSummarizeCount(messages) : 0,
    messagesToKeep: config.recentMessagesToKeep,
  };
}

// ============================================================================
// Tool-to-Agent Mapping
// ============================================================================

/**
 * Map tool names to their owning sub-agent
 * Used to detect which agent is responding during streaming
 */
const TOOL_AGENT_MAP: Record<string, string> = {
  // ---- Scanner tools ----
  // marketTools cherry-picks
  scan_market: "Scanner",
  get_historical_opportunities: "Scanner",
  // discoveryTools cherry-picks
  get_trending_tokens: "Scanner",
  get_high_volume_tokens: "Scanner",
  get_available_markets: "Scanner",
  // indicatorTools spread (Scanner is primary for shared indicator tools)
  get_technical_analysis: "Scanner",
  get_technical_signals: "Scanner",
  get_rsi: "Scanner",
  get_stop_loss_levels: "Scanner",
  get_position_size: "Scanner",
  get_vwap: "Scanner",
  get_camarilla_pivots: "Scanner",
  get_markov_regime: "Scanner",
  get_supertrend: "Scanner",
  get_ichimoku: "Scanner",
  get_flowscope: "Scanner",
  get_angled_market_structure: "Scanner",
  get_false_breakout: "Scanner",
  get_adx: "Scanner",
  get_divergence: "Scanner",
  get_supply_demand_zones: "Scanner",
  get_squeeze_momentum: "Scanner",
  get_fvg: "Scanner",
  get_parabolic_sar: "Scanner",
  get_atr_rope: "Scanner",
  get_linear_regression: "Scanner",
  get_wae: "Scanner",
  // marketDataTools spread (Scanner is primary for raw market data)
  get_candles: "Scanner",
  get_price: "Scanner",
  get_tickers: "Scanner",
  get_book_ticker: "Scanner",
  // strategyTools spread
  list_strategies: "Scanner",
  get_strategy_details: "Scanner",
  detect_strategy: "Scanner",
  scan_for_strategy: "Scanner",
  suggest_strategy: "Scanner",
  run_strategy_ensemble: "Scanner",
  scan_with_ensemble: "Scanner",
  // parallelAnalysisTools spread (Scanner is primary)
  parallel_scan_analyze: "Scanner",
  parallel_multi_coin: "Scanner",
  parallel_deep_analysis: "Scanner",
  parallel_timeframe: "Scanner",
  // evalTools cherry-picks on Scanner
  get_strategy_performance: "Scanner",
  get_performance_context: "Scanner",
  get_all_strategy_performances: "Scanner",
  // baseOnchainTools cherry-picks (Scanner: discovery/info)
  get_base_trending: "Scanner",
  get_base_featured: "Scanner",
  get_base_info: "Scanner",

  // ---- Analyst tools ----
  // marketTools cherry-pick
  analyze_coin: "Analyst",
  // chartTools spread
  display_price_chart: "Analyst",
  display_candlestick_chart: "Analyst",
  display_comparison_chart: "Analyst",
  display_volume_chart: "Analyst",
  // orderbookTools spread (Analyst has full spread)
  get_order_book: "Analyst",
  get_spread: "Analyst",
  get_market_trades: "Analyst",
  get_order_status: "Analyst",
  test_order: "Analyst",
  // marketAnalysisTools spread
  analyze_whale_orders: "Analyst",
  estimate_market_impact: "Analyst",
  scan_breakouts: "Analyst",
  detect_consolidation: "Analyst",
  score_market: "Analyst",
  // compositionTools spread
  run_full_analysis: "Analyst",
  // multiModalChartTools spread
  generate_chart: "Analyst",
  analyze_chart: "Analyst",
  quick_ta: "Analyst",
  // evalTools cherry-picks on Analyst
  get_market_condition_performance: "Analyst",
  get_learning_insights: "Analyst",
  // liquidationIntelligenceTools (on Scanner + Analyst)
  get_cascade_risk: "Scanner",
  get_liquidation_pressure: "Scanner",
  get_crowding_analysis: "Scanner",
  get_squeeze_candidates: "Scanner",
  // pairAnalysisTools (on Scanner + Analyst)
  analyze_pair_correlation: "Analyst",
  analyze_pair_spread: "Analyst",
  compare_pair_performance: "Analyst",
  // baseOnchainTools cherry-picks (Analyst: gas/balance analysis)
  get_base_gas: "Analyst",
  get_base_balance: "Analyst",

  // ---- Planner tools ----
  // tradingTools cherry-picks
  create_plan: "Planner",
  create_grid_plan: "Planner",
  list_plans: "Planner",
  // strategyGenerationTools cherry-picks
  strategy_generate: "Planner",
  strategy_iterate: "Planner",
  list_generated_strategies: "Planner",
  delete_generated_strategy: "Planner",
  // riskManagementTools cherry-picks
  calculate_kelly_size: "Planner",
  calculate_volatility_adjusted_size: "Planner",
  assess_trade_risk: "Planner",
  // evalTools cherry-picks on Planner
  get_risk_reward_analysis: "Planner",
  track_recommendation: "Planner",

  // ---- Executor tools ----
  // tradingTools cherry-picks
  execute_plan: "Executor",
  close_trade: "Executor",
  arm_system: "Executor",
  approve_plan: "Executor",
  set_trailing_stop: "Executor",
  update_trailing_stop: "Executor",
  close_partial_position: "Executor",
  // discoveryTools cherry-picks
  place_bracket_order: "Executor",
  place_market_order: "Executor",
  // orderbookTools cherry-picks
  place_limit_order: "Executor",
  place_oco_order: "Executor",
  cancel_all_orders: "Executor",
  cancel_order: "Executor",
  cancel_replace_order: "Executor",
  cancel_order_list: "Executor",
  // agentKitOnchainTools cherry-picks (Executor: mutations)
  agentkit_native_transfer: "Executor",
  agentkit_erc20_transfer: "Executor",
  agentkit_wrap_eth: "Executor",
  agentkit_request_faucet: "Executor",

  // ---- Monitor tools ----
  // positionTools spread
  check_positions: "Monitor",
  // accountTools spread
  get_portfolio: "Monitor",
  get_account_details: "Monitor",
  get_account_snapshot: "Monitor",
  // earnTools spread
  get_flexible_earn_products: "Monitor",
  get_locked_earn_products: "Monitor",
  get_all_earn_positions: "Monitor",
  subscribe_flexible_earn: "Monitor",
  redeem_flexible_earn: "Monitor",
  subscribe_locked_earn: "Monitor",
  get_earn_history: "Monitor",
  // walletTools spread
  get_dustable_assets: "Monitor",
  convert_dust: "Monitor",
  transfer_funds: "Monitor",
  get_coin_info: "Monitor",
  get_trade_fees: "Monitor",
  get_asset_dividends: "Monitor",
  get_deposit_address: "Monitor",
  get_user_assets: "Monitor",
  get_wallet_balances: "Monitor",
  get_dust_log: "Monitor",
  preview_withdrawal: "Monitor",
  withdraw_to_external: "Monitor",
  get_withdrawal_status: "Monitor",
  // historyTools spread
  get_trade_history: "Monitor",
  get_transfer_history: "Monitor",
  get_order_history: "Monitor",
  get_open_orders: "Monitor",
  get_open_order_lists: "Monitor",
  // metricsTools spread
  get_performance_metrics: "Monitor",
  get_trade_statistics: "Monitor",
  get_risk_analysis: "Monitor",
  // riskManagementTools cherry-picks
  check_exit_conditions: "Monitor",
  check_drawdown_status: "Monitor",
  check_daily_limit: "Monitor",
  // evalTools cherry-picks on Monitor
  record_trade_outcome: "Monitor",
  get_performance_report: "Monitor",
  process_unrecorded_trades: "Monitor",
  get_win_rate_analysis: "Monitor",
  // autonomousTools cherry-pick on Monitor
  get_autonomous_status: "Monitor",
  // agentKitOnchainTools cherry-picks (Monitor: reads)
  agentkit_get_wallet: "Monitor",
  agentkit_get_balance: "Monitor",
  agentkit_erc20_balance: "Monitor",
  // agentKitOnchainTools cherry-picks (Executor: DEX swaps)
  agentkit_swap: "Executor",
  agentkit_get_swap_price: "Analyst",

  // ---- Base L2 signal tools ----
  // baseSignalTools cherry-picks (Scanner: discovery + scanning)
  scan_base_whale_transfers: "Scanner",
  scan_base_volume_spikes: "Scanner",
  scan_base_new_tokens: "Scanner",
  // baseSignalTools cherry-picks (Analyst: analysis + tracking)
  track_base_wallet: "Analyst",
  get_base_token_holders: "Analyst",
  get_base_dex_pairs: "Scanner",

  // ---- Teacher tools ----
  explain: "Teacher",
  strategy_explain: "Teacher",

  // ---- Backtester tools ----
  // backtestTools spread
  run_backtest: "Backtester",
  optimize_strategy: "Backtester",
  compare_backtests: "Backtester",
  get_backtest_summary: "Backtester",
  analyze_backtest_results: "Backtester",
  compare_backtest_results: "Backtester",
  rank_strategies_by_metric: "Backtester",
  find_best_strategy: "Backtester",
  export_results_json: "Backtester",
  export_results_csv: "Backtester",
  generate_html_report: "Backtester",
  filter_exclude_months: "Backtester",
  filter_market_hours: "Backtester",
  filter_first_last_hour: "Backtester",
  analyze_alpha_decay: "Backtester",
  generate_backtest_chart: "Backtester",
  grid_search_optimization: "Backtester",
  random_search_optimization: "Backtester",
  run_walk_forward_test: "Backtester",
  run_monte_carlo: "Backtester",
  get_backtest_history: "Backtester",
  save_backtest_result: "Backtester",
  load_backtest_result: "Backtester",

  // ---- Cross-cutting tools (NOT mapped to any agent) ----
  // sharedContextTools and systemTools are used by ALL agents.
  // Mapping them to "Gordon" causes spurious self-handoff detections,
  // so they are intentionally omitted from TOOL_AGENT_MAP.
};

/**
 * Get the agent name that owns a specific tool
 */
function getAgentForTool(toolName: string): string | undefined {
  return TOOL_AGENT_MAP[toolName];
}

// ============================================================================
// Handoff Tracking & Validation
// ============================================================================

/**
 * Handoff record for tracking agent transitions
 */
export interface HandoffRecord {
  handoffId: string;
  fromAgent: string;
  toAgent: string;
  timestamp: number;
  validated: boolean;
  validationReason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Handoff validation result
 */
export interface HandoffValidation {
  valid: boolean;
  reason?: string;
  warnings?: string[];
}

// In-memory handoff tracking
const handoffHistory: HandoffRecord[] = [];
let handoffCounter = 0;

/**
 * Valid agent transition rules
 * Defines which agents can hand off to which other agents
 */
const VALID_HANDOFF_RULES: Record<string, string[]> = {
  Gordon: ["Scanner", "Analyst", "Planner", "Executor", "Monitor", "Teacher", "Backtester"],
  Scanner: ["Analyst", "Gordon"],
  Analyst: ["Planner", "Scanner", "Gordon"],
  Planner: ["Executor", "Analyst", "Gordon"],
  Executor: ["Monitor", "Planner", "Gordon"],
  Monitor: ["Planner", "Analyst", "Gordon"],
  Teacher: ["Gordon"],
  Backtester: ["Analyst", "Gordon"],
};

/**
 * Validate a handoff between agents
 *
 * @param fromAgent - The agent handing off
 * @param toAgent - The agent receiving the handoff
 * @param context - Optional additional context for validation
 * @returns Validation result
 */
export function validateHandoff(
  fromAgent: string,
  toAgent: string,
  context?: Record<string, unknown>
): HandoffValidation {
  const warnings: string[] = [];

  // Check if fromAgent is known
  if (!VALID_HANDOFF_RULES[fromAgent]) {
    return {
      valid: false,
      reason: `Unknown source agent: ${fromAgent}`,
    };
  }

  // Check if toAgent is known
  const knownAgents = Object.keys(VALID_HANDOFF_RULES);
  if (!knownAgents.includes(toAgent)) {
    return {
      valid: false,
      reason: `Unknown target agent: ${toAgent}`,
    };
  }

  // Check if the transition is allowed
  const allowedTargets = VALID_HANDOFF_RULES[fromAgent]!;
  if (!allowedTargets.includes(toAgent)) {
    return {
      valid: false,
      reason: `Handoff from ${fromAgent} to ${toAgent} is not allowed. Allowed targets: ${allowedTargets.join(", ")}`,
    };
  }

  // Check for circular handoffs in recent history
  const recentHandoffs = handoffHistory.slice(-10);
  const circularCount = recentHandoffs.filter(
    (h) => h.fromAgent === toAgent && h.toAgent === fromAgent
  ).length;
  if (circularCount >= 3) {
    warnings.push(`Detected potential circular handoff pattern between ${fromAgent} and ${toAgent}`);
  }

  // Check for rapid handoffs (potential infinite loop)
  const lastSecondHandoffs = handoffHistory.filter(
    (h) => Date.now() - h.timestamp < 1000
  );
  if (lastSecondHandoffs.length >= 5) {
    warnings.push("High handoff frequency detected. Possible infinite loop.");
  }

  // Executor requires armed state for execution
  if (toAgent === "Executor" && context?.mode !== "ARMED") {
    warnings.push("Handoff to Executor while system is not ARMED");
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Track an agent handoff
 *
 * @param fromAgent - The agent handing off
 * @param toAgent - The agent receiving the handoff
 * @param metadata - Optional metadata about the handoff
 * @returns The handoff record
 */
export async function trackHandoff(
  fromAgent: string,
  toAgent: string,
  metadata?: Record<string, unknown>
): Promise<HandoffRecord> {
  const handoffId = `handoff_${Date.now()}_${++handoffCounter}`;

  // Validate the handoff
  const validation = validateHandoff(fromAgent, toAgent, metadata);

  const record: HandoffRecord = {
    handoffId,
    fromAgent,
    toAgent,
    timestamp: Date.now(),
    validated: validation.valid,
    validationReason: validation.reason,
    metadata,
  };

  // Store in history
  handoffHistory.push(record);
  recordNetworkRouting(fromAgent, toAgent);

  // Keep only last 100 handoffs
  if (handoffHistory.length > 100) {
    handoffHistory.shift();
  }

  // Emit handoff acknowledgment event
  await emitEvent("agent:handoff_ack", {
    fromAgent,
    toAgent,
    validated: validation.valid,
    reason: validation.reason || (validation.warnings?.join("; ")),
    handoffId,
  });

  // Log the handoff
  if (validation.valid) {
    logger.info("Agent handoff tracked", {
      handoffId,
      fromAgent,
      toAgent,
      warnings: validation.warnings,
    });
  } else {
    logger.warn("Invalid agent handoff attempted", {
      handoffId,
      fromAgent,
      toAgent,
      reason: validation.reason,
    });
  }

  return record;
}

/**
 * Get recent handoff history
 */
export function getHandoffHistory(limit: number = 20): HandoffRecord[] {
  return handoffHistory.slice(-limit);
}

/**
 * Clear handoff history (for testing)
 */
export function clearHandoffHistory(): void {
  handoffHistory.length = 0;
  handoffCounter = 0;
}

// ============================================================================
// Request Context Helper
// ============================================================================

/**
 * Create a RequestContext with Gordon's dependencies
 * This is how we inject context into tools in Mastra
 */
function createRequestContext(context: GordonContext): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set("binance", context.binance);
  requestContext.set("exchange", context.exchange);
  requestContext.set("config", context.config);
  requestContext.set("llm", context.llm);
  requestContext.set("userId", context.userId || "default");
  requestContext.set("portfolioValue", context.portfolioValue || 0);
  requestContext.set("availableCash", context.availableCash || 0);
  return requestContext;
}

// ============================================================================
// Stream Event Types
// ============================================================================

/**
 * Stream event types emitted during processing
 */
export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_end" | "agent_switch" | "step_complete" | "done" | "error";
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  agentName?: string;
  stepIndex?: number;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ============================================================================
// Streaming Message Processing (SOTA)
// ============================================================================

/**
 * Process a message with streaming support using Mastra's stream() method
 *
 * This is the primary way to interact with Gordon - provides real-time feedback
 * as the agent thinks, calls tools, and generates responses.
 *
 * @param userMessage - The user's input message
 * @param context - Gordon's context (binance, llm, config, etc.)
 * @param threadId - Thread ID for conversation persistence (enables session resume)
 * @param resourceId - Resource/user ID for memory association (optional, defaults to context.userId)
 */
export async function* processMessageStream(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): AsyncGenerator<StreamEvent, void> {
  const startTime = Date.now();
  logger.debug("Starting streaming message processing", { messageLength: userMessage.length });

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");

    // Audit log the blocked input
    auditLog.blocked(
      context.userId || "unknown",
      "GUARDRAIL_TRIGGERED",
      { message: userMessage.substring(0, 100) },
      inputCheck.reason || "Input blocked by guardrail"
    );

    yield { type: "error", error: inputCheck.reason };
    return;
  }

  const requestContext = createRequestContext(context);

  try {
    // Emit agent started event
    await emitEvent("agent:started", { agent: "gordon" });

    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use Mastra's stream() method for real-time responses
    // Pass threadId and resourceId inside memory option for Mastra's newer execution path
    // This ensures sub-agents also receive thread/resource context for working memory updates
    const effectiveResourceId = resourceId || context.userId || "default";
    const streamResult = await gordonAgent().stream(userMessage, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: {
          thread: threadId,
          resource: effectiveResourceId,
        },
      } : {}),
      maxSteps: 20,
      ...(tracingOptions && { tracingOptions }),
    } as Record<string, unknown>);

    let fullText = "";
    let currentAgent: string | undefined;

    // Mastra's stream() returns a MastraModelOutput with fullStream for all events
    // Use type assertion to access the streaming interface
    interface StreamChunk {
      type: string;
      payload?: {
        agentId?: string;
        toolName?: string;
        text?: string;  // Mastra uses 'text' in TextDeltaPayload
        args?: Record<string, unknown>;
        result?: unknown;
      };
    }

    const streamObj = streamResult as unknown as {
      fullStream?: ReadableStream<StreamChunk>;
      textStream?: AsyncIterable<string>;
      text?: string | (() => Promise<string>) | Promise<string>;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
    };

    // Debug: Log available properties on the stream result
    logger.debug("Stream result properties", {
      hasFullStream: !!streamObj.fullStream,
      hasTextStream: !!streamObj.textStream,
      hasText: !!streamObj.text,
      textType: typeof streamObj.text,
    });

    // Try fullStream first for complete event information (including tool calls and agent switches)
    if (streamObj.fullStream) {
      const reader = streamObj.fullStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = value as StreamChunk;

          switch (chunk.type) {
            case "text-delta":
              // Mastra's TextDeltaPayload uses 'text' field, not 'textDelta'
              if (chunk.payload?.text) {
                const outputCheck = await checkOutputGuardrails(chunk.payload.text);
                const sanitizedChunk = outputCheck.sanitized;
                fullText += sanitizedChunk;
                yield {
                  type: "text_delta",
                  content: sanitizedChunk,
                  agentName: currentAgent,
                };
              }
              break;

            case "tool-call":
              if (chunk.payload?.toolName) {
                const toolName = chunk.payload.toolName;
                const detectedAgent = getAgentForTool(toolName);

                // Emit agent switch if we detected a different agent
                if (detectedAgent && detectedAgent !== currentAgent) {
                  const previousAgent = currentAgent || "Gordon";
                  currentAgent = detectedAgent;

                  // Track the handoff
                  await trackHandoff(previousAgent, currentAgent, {
                    toolName,
                    mode: context.config?.mode,
                  });

                  yield {
                    type: "agent_switch",
                    agentName: currentAgent,
                  };
                }

                yield {
                  type: "tool_call_start",
                  toolName,
                  toolArgs: chunk.payload.args,
                  agentName: currentAgent,
                };
              }
              break;

            case "tool-result":
              yield {
                type: "tool_call_end",
                toolName: chunk.payload?.toolName,
                toolResult: chunk.payload?.result,
                agentName: currentAgent,
              };
              break;

            case "agent-execution-start":
            case "routing-agent-start":
              if (chunk.payload?.agentId) {
                const agentId = chunk.payload.agentId;
                // Capitalize agent name for display
                const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);
                if (agentName !== currentAgent && agentName.toLowerCase() !== "gordon") {
                  const previousAgent = currentAgent || "Gordon";
                  currentAgent = agentName;

                  // Track the handoff
                  await trackHandoff(previousAgent, currentAgent, {
                    eventType: chunk.type,
                    mode: context.config?.mode,
                  });

                  yield {
                    type: "agent_switch",
                    agentName: currentAgent,
                  };
                }
              }
              break;

            // Handle routing agent text (from network routing decisions)
            // Show this text — the ChatView case-insensitive check prevents "Gordon via Gordon" display
            case "routing-agent-text-delta":
              if (chunk.payload?.text) {
                const outputCheck = await checkOutputGuardrails(chunk.payload.text);
                const sanitizedChunk = outputCheck.sanitized;
                fullText += sanitizedChunk;
                yield {
                  type: "text_delta",
                  content: sanitizedChunk,
                  agentName: currentAgent || "Gordon",
                };
              }
              break;

            default:
              // Handle agent-execution-event-* types (sub-agent wrapped events)
              if (chunk.type?.startsWith("agent-execution-event-")) {
                const innerType = chunk.type.replace("agent-execution-event-", "");
                const innerPayload = chunk.payload as unknown as StreamChunk;

                if (innerType === "text-delta" && innerPayload?.payload?.text) {
                  const outputCheck = await checkOutputGuardrails(innerPayload.payload.text);
                  const sanitizedChunk = outputCheck.sanitized;
                  fullText += sanitizedChunk;
                  yield {
                    type: "text_delta",
                    content: sanitizedChunk,
                    agentName: currentAgent,
                  };
                } else if (innerType === "tool-call" && innerPayload?.payload?.toolName) {
                  const toolName = innerPayload.payload.toolName;
                  const detectedAgent = getAgentForTool(toolName);
                  if (detectedAgent && detectedAgent !== currentAgent) {
                    const previousAgent = currentAgent || "Gordon";
                    currentAgent = detectedAgent;

                    // Track the handoff
                    await trackHandoff(previousAgent, currentAgent, {
                      toolName,
                      eventType: "agent-execution-event",
                      mode: context.config?.mode,
                    });

                    yield {
                      type: "agent_switch",
                      agentName: currentAgent,
                    };
                  }
                  yield {
                    type: "tool_call_start",
                    toolName,
                    toolArgs: innerPayload.payload.args,
                    agentName: currentAgent,
                  };
                } else if (innerType === "tool-result") {
                  yield {
                    type: "tool_call_end",
                    toolName: innerPayload?.payload?.toolName,
                    toolResult: innerPayload?.payload?.result,
                    agentName: currentAgent,
                  };
                }
              }
              break;
          }
        }
      } finally {
        reader.releaseLock();
      }

    } else if (streamObj.textStream && typeof streamObj.textStream[Symbol.asyncIterator] === 'function') {
      // Fallback to textStream if fullStream is not available
      // Stream text chunks as they arrive
      // OUTPUT GUARDRAIL: Sanitize each chunk for sensitive data
      for await (const chunk of streamObj.textStream) {
        const outputCheck = await checkOutputGuardrails(chunk);
        const sanitizedChunk = outputCheck.sanitized;
        fullText += sanitizedChunk;
        yield {
          type: "text_delta",
          content: sanitizedChunk,
          agentName: currentAgent,
        };
      }
    } else if (typeof streamObj.text === 'function') {
      // text is a promise function
      const rawText = await streamObj.text();
      logger.debug("Got text from function", { textLength: rawText?.length });
      if (rawText) {
        // OUTPUT GUARDRAIL: Sanitize the response
        const outputCheck = await checkOutputGuardrails(rawText);
        fullText = outputCheck.sanitized;
        yield {
          type: "text_delta",
          content: fullText,
          agentName: currentAgent,
        };
      }
    } else if (streamObj.text instanceof Promise) {
      // text is a Promise
      const rawText = await streamObj.text;
      logger.debug("Got text from Promise", { textLength: rawText?.length });
      if (rawText) {
        const outputCheck = await checkOutputGuardrails(rawText);
        fullText = outputCheck.sanitized;
        yield {
          type: "text_delta",
          content: fullText,
          agentName: currentAgent,
        };
      }
    } else if (typeof streamObj.text === 'string') {
      // OUTPUT GUARDRAIL: Sanitize the response
      logger.debug("Got text as string", { textLength: streamObj.text?.length });
      const outputCheck = await checkOutputGuardrails(streamObj.text);
      fullText = outputCheck.sanitized;
      yield {
        type: "text_delta",
        content: fullText,
        agentName: currentAgent,
      };
    } else {
      // No text available - log warning
      logger.warn("No text content available in stream result", {
        textType: typeof streamObj.text,
        textValue: streamObj.text,
      });
    }

    // If we still have no text, try awaiting the text property as a final fallback
    if (!fullText && streamObj.text) {
      logger.debug("Attempting final text fallback");
      try {
        let finalText: string | undefined;
        if (typeof streamObj.text === 'function') {
          finalText = await streamObj.text();
        } else if (streamObj.text instanceof Promise) {
          finalText = await streamObj.text;
        } else if (typeof streamObj.text === 'string') {
          finalText = streamObj.text;
        }

        if (finalText && finalText.trim()) {
          const outputCheck = await checkOutputGuardrails(finalText);
          fullText = outputCheck.sanitized;
          yield {
            type: "text_delta",
            content: fullText,
            agentName: currentAgent,
          };
          logger.debug("Got text from final fallback", { textLength: fullText.length });
        }
      } catch (textError) {
        logger.error("Failed to get text from fallback", textError as Error);
      }
    }

    // Get usage stats
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (streamObj.usage) {
      const usageData = streamObj.usage instanceof Promise ? await streamObj.usage : streamObj.usage;
      usage = {
        promptTokens: usageData.inputTokens || 0,
        completionTokens: usageData.outputTokens || 0,
        totalTokens: usageData.totalTokens || 0,
      };
    }

    // Emit completion events
    await emitEvent("agent:stream_completed", {
      responseLength: fullText.length,
    });

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    // Record agent-level metrics
    const finalAgent = currentAgent || "Gordon";
    recordAgentCall(
      finalAgent,
      Date.now() - startTime,
      true,
      usage.totalTokens
    );

    // Log warning if no content was generated
    if (!fullText || fullText.trim().length === 0) {
      logger.warn("Stream completed with empty content", {
        userMessage: userMessage.substring(0, 100),
        hasFullStream: !!streamObj.fullStream,
        hasTextStream: !!streamObj.textStream,
        textType: typeof streamObj.text,
      });
    }

    yield {
      type: "done",
      content: fullText,
      usage,
      agentName: currentAgent,
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Streaming error", error);

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

    // Record agent-level failure metrics
    recordAgentCall(
      "Gordon", // Use Gordon as default when we don't know which agent failed
      Date.now() - startTime,
      false,
      0,
      error.name || "UnknownError",
      error.message
    );

    await emitEvent("system:error", {
      error: {
        name: error.name,
        message: error.message,
      },
    });

    yield {
      type: "error",
      error: error.message,
    };
  }
}

// ============================================================================
// Agent Network Processing (SOTA Multi-Agent)
// ============================================================================

/**
 * Process a message using Mastra's Agent Network for automatic multi-agent routing
 *
 * The network automatically delegates to the most appropriate sub-agent
 * (Scanner, Analyst, Planner, etc.) based on user intent.
 *
 * @param userMessage - The user's input message
 * @param context - Gordon's context (binance, llm, config, etc.)
 * @param threadId - Thread ID for conversation persistence (enables session resume)
 * @param resourceId - Resource/user ID for memory association (optional)
 */
export async function* processWithNetwork(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): AsyncGenerator<StreamEvent, void> {
  const startTime = Date.now();
  logger.debug("Starting network processing", { messageLength: userMessage.length });

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    yield { type: "error", error: inputCheck.reason };
    return;
  }

  const requestContext = createRequestContext(context);

  try {
    await emitEvent("agent:started", { agent: "gordon-network" });

    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use Agent Network for automatic routing between sub-agents
    // Pass threadId and resourceId inside memory option for Mastra's network execution path
    // This ensures sub-agents also receive thread/resource context for working memory updates
    const effectiveResourceId = resourceId || context.userId || "default";
    const networkResult = await gordonAgent().network(userMessage, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: {
          thread: threadId,
          resource: effectiveResourceId,
        },
      } : {}),
      maxSteps: 30,
      ...(tracingOptions && { tracingOptions }),
    } as Record<string, unknown>);

    // Stream the network result
    let fullText = "";

    // Network result is a MastraAgentNetworkStream
    const resultObj = networkResult as unknown as {
      text?: string | (() => Promise<string>);
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
    };

    // Get the text result
    if (typeof resultObj.text === 'function') {
      fullText = await resultObj.text();
    } else if (typeof resultObj.text === 'string') {
      fullText = resultObj.text;
    }

    // OUTPUT GUARDRAIL: Sanitize the response for sensitive data
    const outputCheck = await checkOutputGuardrails(fullText);
    fullText = outputCheck.sanitized;

    yield {
      type: "text_delta",
      content: fullText,
    };

    await emitEvent("agent:stream_completed", {
      responseLength: fullText.length,
    });

    // Get usage stats
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (resultObj.usage) {
      const usageData = resultObj.usage instanceof Promise ? await resultObj.usage : resultObj.usage;
      usage = {
        promptTokens: usageData.inputTokens || 0,
        completionTokens: usageData.outputTokens || 0,
        totalTokens: usageData.totalTokens || 0,
      };
    }

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    yield {
      type: "done",
      content: fullText,
      usage,
    };

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Network processing error", error);

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

    yield {
      type: "error",
      error: error.message,
    };
  }
}

// ============================================================================
// Non-Streaming Message Processing (Backwards Compatible)
// ============================================================================

/**
 * Process a user message through Gordon using Mastra Agent
 *
 * This is the simple, non-streaming version for backwards compatibility.
 * Prefer processMessageStream() for better UX.
 *
 * @param userMessage - The user's input message
 * @param context - Gordon's context (binance, llm, config, etc.)
 * @param threadId - Thread ID for conversation persistence (enables session resume)
 * @param resourceId - Resource/user ID for memory association (optional)
 * @returns The agent's response and usage stats
 */
export async function processMessage(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): Promise<{
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const startTime = Date.now();
  logger.debug("Processing message with Mastra", { messageLength: userMessage.length });

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    return {
      response: inputCheck.reason || "Input blocked by safety guardrail.",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  const requestContext = createRequestContext(context);

  try {
    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use generate() for non-streaming responses
    // Pass threadId and resourceId inside memory option for Mastra's newer execution path
    // This ensures sub-agents also receive thread/resource context for working memory updates
    const effectiveResourceId = resourceId || context.userId || "default";
    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: {
          thread: threadId,
          resource: effectiveResourceId,
        },
      } : {}),
      maxSteps: 20,
      ...(tracingOptions && { tracingOptions }),
    } as Record<string, unknown>);

    // Extract text from result - Mastra returns { text, usage, ... }
    const resultObj = result as unknown as {
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

    const rawResponse = resultObj.text || "I'm not sure how to help with that.";

    // OUTPUT GUARDRAIL: Sanitize response for sensitive data
    const outputCheck = await checkOutputGuardrails(rawResponse);
    const response = outputCheck.sanitized;

    // Emit event for tracking
    await emitEvent("agent:message_processed", {
      userMessage: userMessage.substring(0, 100),
      responseLength: response.length,
      historyLength: 0, // Not tracking history length in this context
    });

    logger.debug("Message processed", { responseLength: response.length });

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    return {
      response,
      usage: {
        promptTokens: resultObj.usage?.inputTokens || 0,
        completionTokens: resultObj.usage?.outputTokens || 0,
        totalTokens: resultObj.usage?.totalTokens || 0,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Failed to process message", error);

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

    throw error;
  }
}

/**
 * Process a simple message without full tool access
 * Use this for quick single-turn responses
 */
export async function processSimpleMessage(
  userMessage: string,
  context: GordonContext
): Promise<string> {
  const startTime = Date.now();

  // INPUT GUARDRAIL: Check for dangerous patterns before processing
  const inputCheck = await checkInputGuardrails(userMessage);
  if (!inputCheck.allowed) {
    logger.warn("Input blocked by guardrail", { reason: inputCheck.reason });
    recordRequest(Date.now() - startTime, false);
    recordError("InputGuardrailBlock");
    return inputCheck.reason || "Input blocked by safety guardrail.";
  }

  const requestContext = createRequestContext(context);

  try {
    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    const result = await gordonAgent().generate(userMessage, {
      requestContext,
      maxSteps: 5, // Limit steps for simple queries
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as { text?: string };
    const rawResponse = resultObj.text || "I'm not sure how to help with that.";

    // OUTPUT GUARDRAIL: Sanitize response for sensitive data
    const outputCheck = await checkOutputGuardrails(rawResponse);

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    return outputCheck.sanitized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");

    throw error;
  }
}

// ============================================================================
// Quick Actions (bypass full agent loop for simple tasks)
// ============================================================================

/**
 * Quick scan without full agent processing
 */
export async function quickScan(context: GordonContext) {
  const { exchange, config } = context;

  if (!exchange) {
    throw new Error("Exchange client not connected");
  }

  const { scan } = await import("../../core/scanner.ts");
  return scan(exchange, {
    topN: config.preferences.topNCoins,
    timeframes: config.preferences.defaultTimeframes,
  });
}

/**
 * Quick position check without full agent processing
 */
export async function quickCheckPositions(context: GordonContext) {
  const { exchange } = context;

  if (!exchange) {
    throw new Error("Exchange client not connected");
  }

  const { runMonitorCycle } = await import("../../core/monitor.ts");
  return runMonitorCycle(exchange);
}

// ============================================================================
// Tracing & Observability
// ============================================================================

/**
 * Initialize OpenTelemetry tracing for agent operations
 *
 * This initializes the tracing infrastructure and logs configuration.
 * When OTEL_TRACING_ENABLED=true, traces will be exported to the
 * configured OTLP endpoint.
 *
 * Environment variables:
 * - OTEL_TRACING_ENABLED: Enable tracing (default: false)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint URL
 * - OTEL_SERVICE_NAME: Service name for traces
 */
export function initializeTracing(): void {
  // Initialize the tracing module
  initTracingModule();

  // Log configuration status
  const config = getTracingConfig();
  if (config.enabled) {
    logger.info("OpenTelemetry tracing enabled", {
      serviceName: config.serviceName,
      endpoint: config.endpoint,
    });
  } else {
    logger.debug("Tracing disabled (set OTEL_TRACING_ENABLED=true to enable)");
  }
}

/**
 * Create tracing options for agent calls
 *
 * This builds the tracingOptions object that can be passed to
 * agent.generate() or agent.stream() calls for distributed tracing.
 */
function createAgentTracingOptions(parentContext?: SpanContext): Record<string, unknown> | undefined {
  if (!isTracingEnabled()) {
    return undefined;
  }

  const tracingOpts = buildTracingOptions({
    parentContext,
    metadata: {
      agent: "gordon",
      timestamp: new Date().toISOString(),
    },
    tags: ["gordon-agent"],
  });

  // Cast to Record<string, unknown> to match Mastra's expected type
  return tracingOpts as Record<string, unknown>;
}

// ============================================================================
// Security Middleware for Tool Execution
// ============================================================================

/**
 * Result of security check before tool execution
 */
export interface ToolSecurityCheckResult {
  allowed: boolean;
  error?: string;
  accessControlResult?: Awaited<ReturnType<typeof checkToolAccess>>;
  rateLimitResult?: RateLimitResult;
}

/**
 * Check security constraints before tool execution
 *
 * This function combines:
 * - Access control (ARMED mode check for trading tools)
 * - Rate limiting (per-agent-per-tool limits)
 *
 * @param agentName - Name of the agent making the call
 * @param toolName - Name of the tool being called
 * @param context - Gordon context with config
 * @param options - Optional configuration
 * @returns ToolSecurityCheckResult with allowed status and details
 */
export async function checkToolSecurity(
  agentName: string,
  toolName: string,
  context: GordonContext,
  options: { rateLimit?: number } = {}
): Promise<ToolSecurityCheckResult> {
  const userId = context.userId || "unknown";

  // Check access control (ARMED mode for trading tools)
  const accessResult = await checkToolAccess(toolName, context.config, userId);
  if (!accessResult.allowed) {
    return {
      allowed: false,
      error: accessResult.reason,
      accessControlResult: accessResult,
    };
  }

  // Check rate limiting
  const rateLimitResult = enforceRateLimit(agentName, toolName, options.rateLimit);
  if (!rateLimitResult.allowed) {
    auditLog.record(
      userId,
      "RATE_LIMIT_EXCEEDED",
      { agentName, toolName },
      "BLOCKED",
      { resultDetails: rateLimitResult.error }
    );

    return {
      allowed: false,
      error: rateLimitResult.error,
      rateLimitResult,
    };
  }

  return {
    allowed: true,
    accessControlResult: accessResult,
    rateLimitResult,
  };
}

/**
 * Initialize client with permission check
 * Should be called when connecting to Binance (limited support for other exchanges)
 *
 * @param context - Gordon context with exchange client
 * @returns Permission check result
 */
export async function initializeWithPermissionCheck(context: GordonContext): Promise<{
  success: boolean;
  warnings: string[];
  errors: string[];
  isReadOnly: boolean;
}> {
  if (!context.exchange) {
    return {
      success: false,
      warnings: [],
      errors: ["Exchange client not connected"],
      isReadOnly: true,
    };
  }

  if (!context.binance || context.exchange.exchangeId !== "binance") {
    return {
      success: true,
      warnings: ["Permission check is currently available only for Binance."],
      errors: [],
      isReadOnly: false,
    };
  }

  const result = await checkPermissionsOnInit(context.binance);

  // Audit log the permission check
  if (result.success) {
    auditLog.success(
      context.userId || "system",
      "PERMISSION_CHECK",
      {
        read: result.permissions.read,
        spotTrade: result.permissions.spotTrade,
        withdraw: result.permissions.withdraw,
      },
      { resultDetails: result.isReadOnly ? "Read-only mode" : "Full access" }
    );
  } else {
    auditLog.failure(
      context.userId || "system",
      "PERMISSION_CHECK",
      {},
      result.errors.join("; ")
    );
  }

  return {
    success: result.success,
    warnings: result.warnings,
    errors: result.errors,
    isReadOnly: result.isReadOnly,
  };
}

// ============================================================================
// Parallel Execution
// ============================================================================

// Re-export parallel execution utilities for external use
export {
  runParallel,
  runParallelAgentCalls,
  runParallelCoinAnalysis,
  runParallelTimeframeAnalysis,
  runDeepParallelAnalysis,
  runMultiCoinParallelAnalysis,
  createScanAnalyzeWorkflow,
  createWorkflowStep,
  // Streaming workflow support
  createStreamingWorkflow,
  streamParallelAnalysis,
  streamMultiCoinAnalysis,
  createStreamingDeepAnalysis,
  createStreamingMultiCoinAnalysis,
  // Stream writers
  createConsoleWriter,
  createArrayWriter,
  createCallbackWriter,
  createMultiplexWriter,
  createTransformWriter,
  ConsoleStreamWriter,
  ArrayStreamWriter,
  CallbackStreamWriter,
  MultiplexStreamWriter,
  TransformStreamWriter,
  // Chunk factories
  createChunk,
  createProgressChunk,
  createResultChunk,
  createErrorChunk,
  createStartChunk,
  createEndChunk,
  createHeartbeatChunk,
  createStreamingPipeline,
  // Types
  type ParallelResult,
  type ParallelOptions,
  type AgentCallSpec,
  type AgentCallResult,
  type DeepParallelAnalysisResult,
  type MultiCoinParallelResult,
  type WorkflowStepDef,
  type ParallelScanAnalyzeResult,
  type StreamWriter,
  type StreamChunk,
  type StreamingWorkflowOptions,
  type ProgressData,
  type ResultData,
  type AnalysisChunk,
  type StreamingResult,
  type StreamingWorkflowResult,
  type StreamingParallelOptions,
} from "./parallel.ts";

// ============================================================================
// Streaming with Pipe Support (Mastra pipeTo Pattern)
// ============================================================================

/**
 * Stream chunk type for message processing
 */
export interface MessageStreamChunk {
  type: StreamEvent["type"];
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  agentName?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Process a message with streaming and pipe to a custom writer.
 *
 * This implements the Mastra pipeTo(writer) pattern for message processing,
 * allowing real-time streaming to custom destinations like files, WebSockets,
 * or other stream consumers.
 *
 * @example
 * ```typescript
 * // Stream to console for debugging
 * const consoleWriter = createConsoleWriter("[Gordon]");
 * await processMessageStreamWithPipe(
 *   "Analyze BTC",
 *   context,
 *   consoleWriter
 * );
 *
 * // Stream to WebSocket
 * const wsWriter = createCallbackWriter(chunk => ws.send(JSON.stringify(chunk)));
 * await processMessageStreamWithPipe(
 *   "Scan market",
 *   context,
 *   wsWriter
 * );
 *
 * // Collect chunks in array
 * const arrayWriter = createArrayWriter<MessageStreamChunk>();
 * await processMessageStreamWithPipe(
 *   "Check positions",
 *   context,
 *   arrayWriter
 * );
 * console.log(arrayWriter.getChunks());
 * ```
 *
 * @param userMessage - The user's input message
 * @param context - Gordon's context (binance, llm, config, etc.)
 * @param writer - The stream writer to pipe results to
 * @param threadId - Thread ID for conversation persistence (optional)
 * @param resourceId - Resource/user ID for memory association (optional)
 * @returns StreamingResult with statistics about the operation
 */
export async function processMessageStreamWithPipe(
  userMessage: string,
  context: GordonContext,
  writer: StreamWriter<MessageStreamChunk>,
  threadId?: string,
  resourceId?: string
): Promise<StreamingResult<{ response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>> {
  const startTime = Date.now();
  let chunksWritten = 0;
  let errors = 0;
  let fullText = "";
  let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  try {
    // Write start chunk
    await writer.write(createStartChunk("message-processing") as unknown as StreamChunk<MessageStreamChunk>);
    chunksWritten++;

    // Process message using the existing stream generator
    const stream = processMessageStream(userMessage, context, threadId, resourceId);

    for await (const event of stream) {
      // Convert StreamEvent to MessageStreamChunk
      const chunk: MessageStreamChunk = {
        type: event.type,
        content: event.content,
        toolName: event.toolName,
        toolArgs: event.toolArgs,
        toolResult: event.toolResult,
        agentName: event.agentName,
        error: event.error,
        usage: event.usage,
      };

      // Write the chunk
      await writer.write(createChunk(
        event.type === "error" ? "error" : "result",
        chunk,
        { source: event.agentName || "Gordon" }
      ) as StreamChunk<MessageStreamChunk>);
      chunksWritten++;

      // Track full text and final usage
      if (event.type === "text_delta" && event.content) {
        fullText += event.content;
      }

      if (event.type === "done") {
        if (event.content) {
          fullText = event.content;
        }
        if (event.usage) {
          finalUsage = event.usage;
        }
      }

      if (event.type === "error") {
        errors++;
      }
    }

    // Write end chunk with summary
    await writer.write(createEndChunk("message-processing", {
      responseLength: fullText.length,
      usage: finalUsage,
    }) as unknown as StreamChunk<MessageStreamChunk>);
    chunksWritten++;

    await writer.close();

    const duration = Date.now() - startTime;

    logger.debug("Message stream with pipe completed", {
      duration,
      chunksWritten,
      errors,
      responseLength: fullText.length,
    });

    return {
      chunksWritten,
      errors,
      duration,
      summary: {
        response: fullText,
        usage: finalUsage,
      },
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Message stream with pipe failed", error);

    // Write error chunk
    await writer.write(createErrorChunk(error, "Gordon") as unknown as StreamChunk<MessageStreamChunk>);
    chunksWritten++;
    errors++;

    if (writer.abort) {
      await writer.abort(error);
    } else {
      await writer.close();
    }

    return {
      chunksWritten,
      errors,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Create a streaming workflow from the message stream.
 *
 * Returns an object that can be piped to any StreamWriter, following
 * the Mastra pipeTo(writer) pattern.
 *
 * @example
 * ```typescript
 * const workflow = createMessageStreamWorkflow("Analyze BTC", context);
 *
 * // Option 1: Pipe to a writer
 * await workflow.pipeTo(myWriter);
 *
 * // Option 2: Consume as async iterator
 * for await (const chunk of workflow) {
 *   console.log(chunk);
 * }
 * ```
 */
export function createMessageStreamWorkflow(
  userMessage: string,
  context: GordonContext,
  threadId?: string,
  resourceId?: string
): {
  pipeTo: (writer: StreamWriter<MessageStreamChunk>) => Promise<StreamingResult<{ response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>>;
  [Symbol.asyncIterator]: () => AsyncIterator<MessageStreamChunk>;
} {
  // Create an async generator that yields MessageStreamChunks
  async function* generator(): AsyncGenerator<MessageStreamChunk, void, unknown> {
    const stream = processMessageStream(userMessage, context, threadId, resourceId);

    for await (const event of stream) {
      yield {
        type: event.type,
        content: event.content,
        toolName: event.toolName,
        toolArgs: event.toolArgs,
        toolResult: event.toolResult,
        agentName: event.agentName,
        error: event.error,
        usage: event.usage,
      };
    }
  }

  const source = generator();

  return {
    async pipeTo(writer: StreamWriter<MessageStreamChunk>): Promise<StreamingResult<{ response: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }>> {
      return processMessageStreamWithPipe(userMessage, context, writer, threadId, resourceId);
    },

    [Symbol.asyncIterator](): AsyncIterator<MessageStreamChunk> {
      return source[Symbol.asyncIterator]();
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export { createRequestContext };

// Re-export summarization utilities
export {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  DEFAULT_SUMMARIZER_CONFIG,
  type SummarizerConfig,
  type TradingContext,
  type SummarizationResult,
} from "../memory/index.ts";
