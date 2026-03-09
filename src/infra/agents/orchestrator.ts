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
import { z } from "zod";

import { gordonAgent } from "./agents.ts";
import {
  buildPromptEnvelope,
  attachCumulativeUsageToPromptReport,
  attachUsageToPromptReport,
  type GroundedPromptMessage,
} from "./contextBudget.ts";
import {
  formatIntegrationGlossary,
  selectRelevantIntegrationGlossary,
} from "./integrationGlossary.ts";
import { evaluateToolRequestPolicy } from "../actions/runtime.ts";
import { getDynamicToolAgentMap } from "../routing/manager.ts";
import { createModuleLogger } from "../logger/index.ts";
import { emitEvent } from "../../events/index.ts";
import {
  checkInputGuardrails,
  checkOutputGuardrails,
  checkToolAccess,
  checkExplicitExecutionAccess,
  requiresArmedModeForTool,
} from "./middleware/index.ts";
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
  classifyRecoveryGuidance,
  formatRecoveryGuidance,
  formatPlanningHandoffBlock,
  getExecutionReadiness,
  getPlanningHandoff,
  optimizeToolResultForContext,
  recordToolCallFingerprint,
  registerPlanningArtifactFromResult,
  resetLoopSignals,
  resetReminderState,
} from "./runtimeHarness.ts";
import { determineWorkflowPhase } from "./workflowPhase.ts";
import {
  runThinkingPhase,
  getThinkingDepthFromContext,
  type ThinkingResult,
} from "./thinkingPhase.ts";
import { runCritiquePhase } from "./critiquePhase.ts";
import {
  validateAndRepairTranscript,
  formatTranscriptRepairBlock,
  validateAndRepairModelMessages,
} from "./transcriptValidator.ts";
import {
  runLifecycleHooks,
  startLifecycleSession,
  endLifecycleSession,
  type LifecycleHookPayload,
} from "./lifecycleHooks.ts";
import { recordSessionCostUsage } from "./sessionCostLedger.ts";
import { compileSubagentProfiles, isToolAllowedForAgent } from "./subagentProfiles.ts";
import { validateHandoffBudget } from "../../gateway/handoffs/index.ts";
import {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  type SummarizerConfig,
  type SummarizationResult,
} from "../memory/index.ts";
import {
  ensureMCPToolsDiscovered,
  getMCPDiscoveryIntent,
  areMCPSchemasDiscovered,
} from "../mcp/client.ts";
import type { Message } from "../llm/types.ts";
import { resetAgents } from "./agents.ts";
import { rebuildACEMemoryForThread, getACEMemorySnapshot } from "./aceMemory.ts";
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
const lifecycleSessionContexts = new Map<string, GordonContext>();
let lifecycleProcessHooksRegistered = false;

function registerLifecycleProcessHooks(): void {
  if (lifecycleProcessHooksRegistered) {
    return;
  }

  lifecycleProcessHooksRegistered = true;
  const closeSessions = (): void => {
    for (const [threadId, context] of lifecycleSessionContexts.entries()) {
      void endLifecycleSession(context, {
        threadId,
        agentName: "Gordon",
      });
      resetReminderState(context);
    }
    lifecycleSessionContexts.clear();
  };

  process.once("beforeExit", closeSessions);
  process.once("exit", closeSessions);
}

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

    await runLifecycleHooks("before_compaction", context, {
      threadId: context.threadId,
      payload: {
        messageCount: messages.length,
        threshold: summarizer.getConfig().messageThreshold,
      },
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

    await runLifecycleHooks("after_compaction", context, {
      threadId: context.threadId,
      payload: {
        summarized: result.summarized,
        messagesSummarized: result.messagesSummarized,
        compactionStage: result.compactionStage,
      },
    });

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
  // Native agent rails
  get_agent_rails_status: "Analyst",
  helius_wallet_overview: "Analyst",
  helius_recent_transactions: "Analyst",
  helius_token_metadata: "Analyst",
  moonpay_currency_limits: "Analyst",
  moonpay_quote: "Analyst",
  moonpay_swap_pairs: "Analyst",
  moonpay_transactions: "Analyst",
  moonpay_customer_limits: "Analyst",
  moonpay_virtual_accounts: "Analyst",
  moonpay_virtual_account_transactions: "Analyst",
  moonpay_verify_webhook: "Analyst",

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
  preview_market_order: "Planner",

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
  // advancedTools cherry-picks
  verify_circuit_breaker_proof: "Executor",

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
  // advancedTools cherry-picks
  query_regime_scoped_memory: "Monitor",
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

  // ---- AgentKit DeFi tools ----
  // Pyth oracle price feeds (read-only, Analyst)
  pyth_get_price_feed: "Analyst",
  pyth_fetch_price: "Analyst",
  // DeFiLlama protocol data (read-only, Scanner + Analyst)
  defillama_search_protocols: "Scanner",
  defillama_get_protocol: "Analyst",
  defillama_get_token_prices: "Analyst",
  // Moonwell lending (state-changing, Executor)
  moonwell_deposit: "Executor",
  moonwell_withdraw: "Executor",
  // Basenames registration (state-changing, Executor)
  basenames_register: "Executor",

  // ---- Polkadot Agent Kit tools ----
  // Asset tools (Monitor: balance reads)
  polkadot_check_balance: "Monitor",
  // Asset tools (Executor: state-changing transfers)
  polkadot_transfer_native: "Executor",
  polkadot_xcm_transfer: "Executor",
  // Staking tools (Analyst: read-only pool info)
  polkadot_get_pool_info: "Analyst",
  // Staking tools (Executor: state-changing staking operations)
  polkadot_join_pool: "Executor",
  polkadot_bond_extra: "Executor",
  polkadot_unbond: "Executor",
  polkadot_withdraw_unbonded: "Executor",
  polkadot_claim_rewards: "Executor",
  // DeFi tools (Executor: state-changing swaps and liquid staking)
  polkadot_swap_tokens: "Executor",
  polkadot_mint_vdot: "Executor",
  polkadot_register_identity: "Executor",
  // Utility tools (Analyst: chain initialization)
  polkadot_initialize_chain: "Analyst",

  // ---- Solana Agent Kit tools (native adapter) ----
  // Wallet & monitoring tools (Monitor: read-only)
  solana_wallet_address: "Monitor",
  solana_balance: "Monitor",
  solana_token_balances: "Monitor",
  solana_get_tps: "Monitor",
  solana_get_open_limit_orders: "Monitor",
  solana_get_limit_order_history: "Monitor",
  // Price & data tools (Analyst: analysis)
  solana_fetch_price: "Analyst",
  solana_pyth_price: "Analyst",
  solana_get_token_data: "Analyst",
  solana_rugcheck: "Analyst",
  // Execution tools (Executor: state-changing)
  solana_trade: "Executor",
  solana_transfer: "Executor",
  solana_create_limit_order: "Executor",
  solana_cancel_limit_orders: "Executor",
  solana_stake_jup: "Executor",
  solana_request_faucet: "Executor",
  solana_launch_pumpfun: "Executor",

  // ---- Solana Agent Kit DeFi tools (native adapter — plugin-defi) ----
  // Perpetuals — read-only (Analyst)
  solana_drift_has_account: "Analyst",
  solana_drift_account_info: "Analyst",
  solana_drift_markets: "Analyst",
  solana_drift_funding_rate: "Analyst",
  solana_drift_perp_quote: "Analyst",
  // Perpetuals — state-changing (Executor)
  solana_adrena_open_long: "Executor",
  solana_adrena_open_short: "Executor",
  solana_adrena_close_long: "Executor",
  solana_adrena_close_short: "Executor",
  solana_flash_open_trade: "Executor",
  solana_flash_close_trade: "Executor",
  solana_drift_open_perp: "Executor",
  solana_drift_create_account: "Executor",
  solana_drift_deposit: "Executor",
  solana_drift_withdraw: "Executor",
  solana_drift_spot_swap: "Executor",
  // Lending & Staking — read-only (Analyst)
  solana_drift_lend_apy: "Analyst",
  solana_sanctum_lst_price: "Analyst",
  solana_sanctum_apy: "Analyst",
  solana_sanctum_tvl: "Analyst",
  solana_sanctum_owned_lst: "Monitor",
  solana_voltr_positions: "Analyst",
  solana_drift_vault_info: "Analyst",
  // Lending & Staking — state-changing (Executor)
  solana_lulo_lend: "Executor",
  solana_lulo_withdraw: "Executor",
  solana_drift_insurance_stake: "Executor",
  solana_drift_insurance_request_unstake: "Executor",
  solana_drift_insurance_unstake: "Executor",
  solana_sanctum_swap_lst: "Executor",
  solana_sanctum_add_liquidity: "Executor",
  solana_sanctum_remove_liquidity: "Executor",
  solana_solayer_stake: "Executor",
  solana_voltr_deposit: "Executor",
  solana_voltr_withdraw: "Executor",
  solana_drift_vault_deposit: "Executor",
  solana_drift_vault_request_withdraw: "Executor",
  solana_drift_vault_withdraw: "Executor",
  // Liquidity Pools — read-only (Analyst)
  solana_orca_fetch_positions: "Analyst",
  // Liquidity Pools — state-changing (Executor)
  solana_orca_open_centered: "Executor",
  solana_orca_open_single_sided: "Executor",
  solana_orca_close_position: "Executor",
  solana_orca_create_clmm: "Executor",
  solana_orca_create_whirlpool: "Executor",
  solana_raydium_create_clmm: "Executor",
  solana_raydium_create_cpmm: "Executor",
  solana_meteora_create_dlmm: "Executor",
  solana_manifest_limit_order: "Executor",
  solana_manifest_cancel_orders: "Executor",
  solana_manifest_withdraw: "Executor",
  // Cross-Chain Bridge — read-only (Analyst)
  solana_debridge_chains: "Analyst",
  solana_debridge_tokens: "Analyst",
  solana_debridge_status: "Analyst",
  solana_okx_quote: "Analyst",
  solana_okx_tokens: "Analyst",
  // Cross-Chain Bridge — state-changing (Executor)
  solana_debridge_create_order: "Executor",
  solana_debridge_execute: "Executor",
  solana_okx_swap: "Executor",
  moonpay_funding_link: "Executor",
  moonpay_swap_link: "Executor",
  polygon_payment_intent: "Executor",

  // ---- Base L2 indexer tools (The Graph) ----
  indexer_top_pools: "Scanner",
  indexer_pool_stats: "Analyst",
  indexer_aerodrome_pools: "Scanner",

  // ---- Uniswap V3 subgraph tools ----
  get_pool_tick_liquidity: "Analyst",
  get_liquidity_events: "Scanner",
  get_pool_flash_events: "Analyst",
  get_lp_positions: "Monitor",
  get_uniswap_protocol_overview: "Scanner",
  get_fee_collections: "Monitor",

  // ---- Multi-chain DEX search tools ----
  search_dex_pairs: "Scanner",
  get_boosted_tokens: "Scanner",

  // ---- DefiLlama yield tools ----
  get_uniswap_pool_yields: "Analyst",
  get_top_defi_yields: "Analyst",

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

  // ---- Position Tracking tools (v0.7) ----
  report_setup: "Scanner",
  report_analysis: "Analyst",
  report_plan: "Planner",
  approve_position: "Planner",
  reject_position: "Planner",
  list_active_positions: "Monitor",
  get_position_detail: "Monitor",
  update_position_live: "Monitor",
  close_position_tracking: "Executor",
  review_position: "Teacher",

  // ---- Risk Gate tools (v0.7) ----
  check_risk: "Planner",

  // ---- Memory tools (v0.7) ----
  search_memory: "Analyst",
  record_observation: "Scanner",
  record_insight: "Analyst",
  get_lessons: "Teacher",
  get_memory_context: "Analyst",

  // ---- Playbook tools (v0.7) ----
  list_playbooks: "Teacher",
  get_playbook: "Teacher",
  search_playbooks: "Scanner",
  get_playbook_for_agent: "Scanner",

  // ---- Playbook Backtest tools (v0.7) ----
  backtest_playbook: "Backtester",
  get_backtest_results: "Backtester",
  get_best_strategy: "Backtester",

  // ---- Systematic research tools ----
  get_systematic_strategy_status: "Backtester",
  list_systematic_datasets: "Backtester",
  list_dataset_snapshots: "Backtester",
  get_dataset_snapshot: "Backtester",
  list_research_experiments: "Backtester",
  analyze_systematic_portfolio: "Monitor",
  diagnose_strategy_bias: "Backtester",
  get_strategy_decay_report: "Monitor",
  list_systematic_lifecycle: "Backtester",
  export_systematic_artifact: "Backtester",

  // ---- Audit tools (v0.7) ----
  query_audit_trail: "Monitor",
  get_decision_path: "Monitor",
  get_agent_activity: "Monitor",
  get_audit_stats: "Monitor",

  // ---- Regime tools (v0.7) ----
  detect_market_regime: "Scanner",
  get_regime_history: "Scanner",
  match_playbooks_to_regime: "Scanner",
  multi_timeframe_regime: "Scanner",

  // ---- Protocol tools (v0.7) ----
  validate_playbook: "Analyst",
  export_playbook: "Analyst",
  import_playbook: "Analyst",
  compare_playbooks: "Analyst",

  // ---- Runtime tools (v0.7) ----
  deploy_strategy: "Planner",
  list_running_strategies: "Planner",
  pause_strategy: "Planner",
  resume_strategy: "Planner",
  stop_strategy: "Planner",
  get_portfolio_state: "Monitor",
  rebalance_portfolio: "Planner",
  check_portfolio_health: "Monitor",
  get_runtime_health_report: "Monitor",
  compare_live_vs_backtest: "Monitor",
  approve_strategy_trade: "Executor",

  // ---- Chainlink tools ----
  // Data Streams (Scanner: bulk, Analyst: individual)
  chainlink_get_price: "Analyst",
  chainlink_get_price_at: "Analyst",
  chainlink_bulk_prices: "Scanner",
  chainlink_list_feeds: "Scanner",
  // Data Feeds (Analyst: on-chain reads)
  chainlink_read_feed: "Analyst",
  chainlink_compare_prices: "Analyst",
  // CCIP (Analyst: info/fees, Executor: transfers, Monitor: status)
  chainlink_ccip_supported_chains: "Analyst",
  chainlink_ccip_get_fee: "Analyst",
  chainlink_ccip_transfer: "Executor",
  chainlink_ccip_status: "Monitor",

  // ---- SynthData tools ----
  synthdata_prediction_percentiles: "Analyst",
  synthdata_volatility: "Analyst",
  synthdata_option_pricing: "Analyst",
  synthdata_leaderboard: "Scanner",
  synthdata_liquidation: "Monitor",
  synthdata_lp_bounds: "Planner",
  synthdata_lp_probabilities: "Planner",

  // ---- Cross-cutting tools (NOT mapped to any agent) ----
  // sharedContextTools and systemTools are used by ALL agents.
  // Mapping them to "Gordon" causes spurious self-handoff detections,
  // so they are intentionally omitted from TOOL_AGENT_MAP.
};

/**
 * Get the agent name that owns a specific tool
 */
function getAgentForTool(toolName: string): string | undefined {
  // Dynamic skill-based map first (MCP/skill tools)
  const dynamicAgent = getDynamicToolAgentMap()[toolName];
  if (dynamicAgent) return dynamicAgent;

  // Static map (built-in tools)
  const agent = TOOL_AGENT_MAP[toolName];
  if (!agent) {
    logger.debug("Unmapped tool called, staying with current agent", { toolName });
  }
  return agent;
}

function buildDefaultExecutorHandoffBudget(
  context: GordonContext,
  toolArgs?: Record<string, unknown>,
): Record<string, unknown> {
  const maxPositionPct = context.config?.riskManagement?.maxPositionSizePercent ?? 10;
  const maxNotionalUsd = Math.max(25, (context.portfolioValue || 0) * (maxPositionPct / 100));
  const symbol =
    typeof toolArgs?.symbol === "string"
      ? toolArgs.symbol.toUpperCase()
      : undefined;

  return {
    maxNotionalUsd,
    maxDrawdownPercent: context.config?.riskManagement?.maxDrawdownPercent ?? 15,
    allowedSymbols: symbol ? [symbol] : undefined,
    reason: "Default executor handoff budget derived from risk config.",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
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

function getCompiledSubagentProfiles() {
  return compileSubagentProfiles(
    TOOL_AGENT_MAP,
    VALID_HANDOFF_RULES,
    getDynamicToolAgentMap(),
  );
}

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
    return {
      valid: false,
      reason: `Blocked circular handoff loop between ${fromAgent} and ${toAgent} (${circularCount} consecutive round-trips detected)`,
    };
  }

  // Check for rapid handoffs (potential infinite loop)
  const lastSecondHandoffs = handoffHistory.filter(
    (h) => Date.now() - h.timestamp < 1000
  );
  if (lastSecondHandoffs.length >= 5) {
    return {
      valid: false,
      reason: "Blocked: high handoff frequency detected (5+ handoffs in 1 second). Possible infinite loop.",
    };
  }

  // Executor requires armed state for execution
  if (toAgent === "Executor" && context?.mode !== "ARMED") {
    warnings.push("Handoff to Executor while system is not ARMED");
  }

  const budgetValidation = validateHandoffBudget({
    fromAgent,
    toAgent,
    metadata: context,
  });
  if (!budgetValidation.valid) {
    return {
      valid: false,
      reason: budgetValidation.reason || "Handoff budget validation failed.",
    };
  }
  if (budgetValidation.warnings && budgetValidation.warnings.length > 0) {
    warnings.push(...budgetValidation.warnings);
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
  const workflowPhase = determineWorkflowPhase(context);
  const executionReadiness = getExecutionReadiness(context);
  const compiledSubagentProfiles = getCompiledSubagentProfiles();
  requestContext.set("binance", context.binance);
  requestContext.set("exchange", context.exchange);
  requestContext.set("broker", context.broker);
  requestContext.set("agentRails", context.agentRails);
  requestContext.set("config", context.config);
  requestContext.set("llm", context.llm);
  requestContext.set("userId", context.userId || "default");
  requestContext.set("threadId", context.threadId || "");
  requestContext.set("portfolioValue", context.portfolioValue || 0);
  requestContext.set("availableCash", context.availableCash || 0);
  requestContext.set("requestedActionId", context.requestedActionId);
  requestContext.set("requestedTaskScope", context.requestedTaskScope);
  requestContext.set("credentialProfile", context.credentialProfile ?? "default");
  requestContext.set("workflowPhase", workflowPhase);
  requestContext.set("executionReadiness", executionReadiness);
  requestContext.set("compiledSubagentProfiles", compiledSubagentProfiles);
  return requestContext;
}

async function buildGroundedPrompt(
  userMessage: string,
  context: GordonContext,
  requestContext: RequestContext,
): Promise<{
  prompt: string;
  messages: GroundedPromptMessage[];
  requestOptions: Record<string, unknown>;
}> {
  let mcpDiscoveryNote = "";
  const transcriptValidation = validateAndRepairTranscript(userMessage, context);
  const sanitizedUserMessage = transcriptValidation.sanitizedUserMessage;

  const discoveryIntent = getMCPDiscoveryIntent(sanitizedUserMessage);
  if (
    discoveryIntent.shouldDiscover &&
    !areMCPSchemasDiscovered(discoveryIntent.matchedServerIds)
  ) {
    try {
      await ensureMCPToolsDiscovered(discoveryIntent.matchedServerIds);
      resetAgents();
      requestContext.set("mcpDiscoveryIntent", discoveryIntent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mcpDiscoveryNote = `Lazy MCP discovery failed for this turn: ${message}. Ignore MCP tools unless the user explicitly retries plugin-related work.`;
    }
  }

  registerLifecycleProcessHooks();
  await startLifecycleSession(context, {
    threadId: context.threadId,
    agentName: "Gordon",
  });
  if (context.threadId) {
    lifecycleSessionContexts.set(context.threadId, context);
  }
  const lifecycleResult = await runLifecycleHooks("before_request", context, {
    threadId: context.threadId,
    userMessage: sanitizedUserMessage,
  });
  if (lifecycleResult.blocked) {
    throw new Error(lifecycleResult.reason ?? "Request blocked by lifecycle hook.");
  }

  const glossarySelection = await selectRelevantIntegrationGlossary(sanitizedUserMessage, context);
  const glossaryText = formatIntegrationGlossary(glossarySelection.entries);
  const planningHandoff = getPlanningHandoff(context);
  const transcriptRepairBlock = formatTranscriptRepairBlock(transcriptValidation);
  const planningHandoffBlock = formatPlanningHandoffBlock(planningHandoff);
  const aceSnapshot = getACEMemorySnapshot(context.threadId);
  const lifecycleAnnotationBlock = lifecycleResult.annotations.length > 0
    ? ["[GORDON_LIFECYCLE_NOTES]", ...lifecycleResult.annotations.map((note) => `- ${note}`)].join("\n")
    : "";

  const envelope = buildPromptEnvelope(sanitizedUserMessage, context, glossarySelection, glossaryText, {
    additionalSections: [
      transcriptRepairBlock
        ? {
            kind: "transcript_repair" as const,
            source: "transcript-validator",
            priority: 70,
            content: transcriptRepairBlock,
          }
        : null,
      planningHandoffBlock
        ? {
            kind: "planning_handoff" as const,
            source: "runtime-harness",
            priority: 80,
            content: planningHandoffBlock,
          }
        : null,
      lifecycleAnnotationBlock
        ? {
            kind: "runtime_reminders" as const,
            source: "lifecycle-hooks",
            priority: 90,
            content: lifecycleAnnotationBlock,
          }
        : null,
      mcpDiscoveryNote
        ? {
            kind: "runtime_reminders" as const,
            source: "mcp-discovery",
            priority: 95,
            content: `[GORDON_RUNTIME_REMINDERS]\n- ${mcpDiscoveryNote}`,
          }
        : null,
      aceSnapshot?.renderedBlock
        ? {
            kind: "tool_hints" as const,
            source: "ace-memory",
            stable: false,
            priority: 96,
            content: aceSnapshot.renderedBlock,
          }
        : null,
    ].filter((section): section is NonNullable<typeof section> => Boolean(section)),
  });

  const messageValidation = validateAndRepairModelMessages(envelope.messages);
  if (messageValidation.repairNotes.length > 0) {
    requestContext.set("modelMessageValidation", messageValidation);
  }

  requestContext.set("integrationGlossaryIds", envelope.report.glossaryIds);
  requestContext.set("activeIntegrationIds", envelope.report.activeIntegrationIds);
  requestContext.set("promptContextReport", envelope.report);
  requestContext.set("promptCacheMetadata", envelope.report.cache);
  requestContext.set("workflowPhase", envelope.report.workflowPhase);
  requestContext.set("executionReadiness", envelope.report.executionReadiness);
  requestContext.set("transcriptValidation", transcriptValidation);
  requestContext.set("planningHandoff", planningHandoff);
  requestContext.set("mcpDiscoveryIntent", discoveryIntent);

  return {
    prompt: envelope.prompt,
    messages: messageValidation.messages,
    requestOptions: envelope.requestOptions,
  };
}

function recordPromptUsage(
  context: GordonContext,
  threadId: string | undefined,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
): void {
  const effectiveThreadId = threadId ?? context.threadId;
  attachUsageToPromptReport(effectiveThreadId, usage);

  const ledger = recordSessionCostUsage({
    threadId: effectiveThreadId ?? "default",
    sessionId: context.threadId,
    resourceId: context.userId,
    provider: context.config.modelConfig?.provider ?? process.env.GORDON_PROVIDER,
    model: context.config.modelConfig?.model ?? process.env.GORDON_MODEL ?? null,
    ...usage,
  });

  attachCumulativeUsageToPromptReport(effectiveThreadId, {
    requestCount: ledger.requestCount,
    promptTokens: ledger.promptTokens,
    completionTokens: ledger.completionTokens,
    totalTokens: ledger.totalTokens,
    updatedAt: ledger.updatedAt,
  });
}

function rebuildThreadACEArtifacts(context: GordonContext, threadId?: string): void {
  const effectiveThreadId = threadId ?? context.threadId;
  if (!effectiveThreadId) {
    return;
  }
  rebuildACEMemoryForThread(effectiveThreadId);
}

async function finalizeAfterRequest(
  context: GordonContext,
  payload: LifecycleHookPayload,
  options: {
    resetLoops?: boolean;
    rebuildAce?: boolean;
  } = {},
): Promise<void> {
  await runLifecycleHooks("after_request", context, payload);
  if (options.rebuildAce !== false && !payload.error) {
    rebuildThreadACEArtifacts(context, payload.threadId);
  }
  if (options.resetLoops !== false) {
    resetLoopSignals(context);
  }
}

// ============================================================================
// Stream Event Types
// ============================================================================

/**
 * Stream event types emitted during processing
 */
export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_end" | "agent_switch" | "step_complete" | "done" | "error" | "cancelled";
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

export interface ProcessMessageStreamOptions {
  signal?: AbortSignal;
}

class StreamCancelledError extends Error {
  constructor(message: string = "Response stopped.") {
    super(message);
    this.name = "StreamCancelledError";
  }
}

async function cancelReadableStreamReader<T>(reader: ReadableStreamDefaultReader<T>): Promise<void> {
  try {
    await reader.cancel("user_cancelled");
  } catch {
    // Ignore reader cancellation failures. The caller is already unwinding.
  }
}

type ReaderReadResult<T> = Awaited<ReturnType<ReadableStreamDefaultReader<T>["read"]>>;

async function readStreamChunkWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal?: AbortSignal
): Promise<ReaderReadResult<T>> {
  if (!signal) {
    return reader.read();
  }

  if (signal.aborted) {
    await cancelReadableStreamReader(reader);
    throw new StreamCancelledError();
  }

  return new Promise<ReaderReadResult<T>>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      void cancelReadableStreamReader(reader);
      reject(new StreamCancelledError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function throwIfStreamAborted(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new StreamCancelledError();
  }
}

function isPlanningArtifactTool(toolName?: string): boolean {
  return toolName === "preview_market_order" || toolName === "create_plan";
}

function requiresPlanningArtifact(toolName?: string): boolean {
  return toolName === "place_market_order" || toolName === "execute_plan" || toolName === "place_bracket_order";
}

async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    throw new StreamCancelledError();
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(new StreamCancelledError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
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
  resourceId?: string,
  options: ProcessMessageStreamOptions = {}
): AsyncGenerator<StreamEvent, void> {
  const startTime = Date.now();
  logger.debug("Starting streaming message processing", { messageLength: userMessage.length });
  const { signal } = options;
  const workflowPhase = determineWorkflowPhase(context);
  let currentAgent: string | undefined;

  // Input guardrails are now handled by GordonInputGuard processor (registered on all agents)
  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    await throwIfStreamAborted(signal);

    // ── Thinking phase (tool-free pre-action reasoning, OPENDEV §2.2.6) ──────
    // ReAct Stage Ordering (per OPENDEV paper §2.2.6):
    // 1. Context compaction check (pressure evaluation) — summarizeIfNeeded upstream
    // 2. Interrupt check (user cancellation gate) — throwIfStreamAborted above
    // 3. Thinking phase (tool-free pre-action reasoning) ← HERE
    // 4. Subagent-completion signal (if a sub-agent returned results)
    // 5. Drain UI-thread messages (approval results, user input)
    // 6. Interrupt check (second gate before LLM call) — throwIfStreamAborted below
    // 7. Action phase LLM call (gordonAgent.stream)
    // 8. Response dispatch: nudges, plan-approved signals, tool-denied nudges
    // 9. Session persistence (auto-save)
    let _thinkingResult: ThinkingResult | null = null;
    const _thinkingDepth = getThinkingDepthFromContext(context);
    if (_thinkingDepth !== "off") {
      _thinkingResult = await runThinkingPhase(userMessage, [], context, _thinkingDepth);
      if (_thinkingDepth === "high" && _thinkingResult && !_thinkingResult.skipped && _thinkingResult.trace) {
        const _critique = await runCritiquePhase(_thinkingResult.trace, userMessage, context);
        if (_critique && _critique !== "Reasoning is sound.") {
          _thinkingResult = { ..._thinkingResult, trace: `${_thinkingResult.trace}\n[Critique]: ${_critique}` };
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Emit agent started event
    await emitEvent("agent:started", { agent: "gordon" });

    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use Mastra's stream() method for real-time responses
    // Pass threadId and resourceId inside memory option for Mastra's newer execution path
    // This ensures sub-agents also receive thread/resource context for working memory updates
    const effectiveResourceId = resourceId || context.userId || "default";
    const streamRequest = gordonAgent().stream(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: {
          thread: threadId,
          resource: effectiveResourceId,
        },
      } : {}),
      maxSteps: 20,
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });
    const streamResult = await awaitWithAbort(streamRequest, signal);

    let fullText = "";
    // Track last sub-agent tool result — used to synthesize a response when
    // Mastra doesn't emit text-delta after a sub-agent tool execution.
    let lastSubAgentToolResult: { toolName: string; result: unknown; agent: string | undefined } | null = null;

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
          const { done, value } = await readStreamChunkWithAbort(reader, signal);
          if (done) break;

          const chunk = value as StreamChunk;

          switch (chunk.type) {
            case "text-delta":
              // Mastra's TextDeltaPayload uses 'text' field, not 'textDelta'
              // Output sanitization is now handled by GordonOutputSanitizer processor
              if (chunk.payload?.text) {
                fullText += chunk.payload.text;
                yield {
                  type: "text_delta",
                  content: chunk.payload.text,
                  agentName: currentAgent,
                };
              }
              break;

            case "tool-call":
              if (chunk.payload?.toolName) {
                const toolName = chunk.payload.toolName;
                const detectedAgent = getAgentForTool(toolName);
                const loopState = recordToolCallFingerprint(
                  context,
                  toolName,
                  chunk.payload.args ?? {},
                );
                if (loopState.blocked) {
                  yield {
                    type: "error",
                    error: formatRecoveryGuidance({
                      category: "policy_block",
                      title: "Repeated tool loop blocked",
                      detail: `${toolName} was invoked ${loopState.count} times with the same arguments in a short window.`,
                      nextSteps: [
                        "Revise the request or narrow the scope before retrying.",
                        "Check whether the active venue or provider is causing the repeated fallback loop.",
                      ],
                    }),
                  };
                  resetLoopSignals(context);
                  return;
                }

                const compiledProfiles = getCompiledSubagentProfiles();
                if (detectedAgent && !isToolAllowedForAgent(compiledProfiles, detectedAgent, toolName)) {
                  yield {
                    type: "error",
                    error: formatRecoveryGuidance({
                      category: "policy_block",
                      title: "Tool blocked by subagent profile",
                      detail: `${toolName} is not allowed for the compiled ${detectedAgent} tool profile.`,
                      nextSteps: [
                        "Retry with a narrower request or a different task scope.",
                        "If this is a real capability gap, update the routed tool map rather than bypassing profile isolation.",
                      ],
                    }),
                  };
                  return;
                }

                const securityCheck = await checkToolSecurity(
                  detectedAgent || currentAgent || "Gordon",
                  toolName,
                  context
                );
                if (!securityCheck.allowed) {
                  const reason = securityCheck.error || `Blocked tool call: ${toolName}`;
                  await emitEvent("guardrail:blocked", {
                    guardrailType: "input",
                    reason,
                    pattern: toolName,
                    length: 0,
                  });
                  yield { type: "error", error: reason };
                  return;
                }

                if (requiresPlanningArtifact(toolName)) {
                  const symbol = typeof chunk.payload.args?.symbol === "string"
                    ? chunk.payload.args.symbol
                    : undefined;
                  const readiness = getExecutionReadiness(context, symbol);
                  if (!readiness.ready) {
                    yield {
                      type: "error",
                      error: formatRecoveryGuidance({
                        category: "approval_required",
                        title: "Execution phase blocked",
                        detail: readiness.reason ?? "Execution requires a recent plan or preview.",
                        nextSteps: [
                          "Run a plan or preview step first in this thread.",
                          "Then retry the live execution step once the plan is explicit.",
                        ],
                      }),
                    };
                    return;
                  }
                }

                // Emit agent switch if we detected a different agent
                if (detectedAgent && detectedAgent !== currentAgent) {
                  const previousAgent = currentAgent || "Gordon";
                  currentAgent = detectedAgent;

                  // Track the handoff
                  await trackHandoff(previousAgent, currentAgent, {
                    toolName,
                    toolArgs: chunk.payload.args,
                    handoffBudget:
                      currentAgent === "Executor"
                        ? buildDefaultExecutorHandoffBudget(context, chunk.payload.args)
                        : undefined,
                    mode: context.config?.mode,
                  });

                  await runLifecycleHooks("agent_switch", context, {
                    threadId: context.threadId,
                    agentName: currentAgent,
                    payload: {
                      fromAgent: previousAgent,
                      toAgent: currentAgent,
                    },
                  });

                  await runLifecycleHooks("subagent_stop", context, {
                    threadId: context.threadId,
                    subagentName: previousAgent,
                    subagentType: previousAgent,
                    payload: { eventType: "subagent_stop" },
                  });

                  await runLifecycleHooks("subagent_start", context, {
                    threadId: context.threadId,
                    subagentName: currentAgent,
                    subagentType: currentAgent,
                    payload: { eventType: "subagent_start" },
                  });

                  yield {
                    type: "agent_switch",
                    agentName: currentAgent,
                  };
                }

                const hookResult = await runLifecycleHooks("tool_call_start", context, {
                  threadId: context.threadId,
                  agentName: currentAgent,
                  toolName,
                  payload: chunk.payload.args,
                });
                if (hookResult.blocked) {
                  yield { type: "error", error: hookResult.reason ?? `Tool blocked before start: ${toolName}` };
                  return;
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
              if (isPlanningArtifactTool(chunk.payload?.toolName)) {
                registerPlanningArtifactFromResult(
                  context,
                  chunk.payload?.toolName ?? "tool",
                  chunk.payload?.result,
                );
              }
              const optimizedToolResult = await optimizeToolResultForContext(
                context,
                chunk.payload?.toolName ?? "tool",
                chunk.payload?.result,
              );
              await runLifecycleHooks("tool_call_end", context, {
                threadId: context.threadId,
                agentName: currentAgent,
                toolName: chunk.payload?.toolName,
                payload: {
                  optimized: optimizedToolResult.offloaded,
                  scratchFile: optimizedToolResult.scratchFile,
                },
              });
              yield {
                type: "tool_call_end",
                toolName: chunk.payload?.toolName,
                toolResult: optimizedToolResult.result,
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
                    handoffBudget:
                      currentAgent === "Executor"
                        ? buildDefaultExecutorHandoffBudget(context)
                        : undefined,
                    mode: context.config?.mode,
                  });

                  await runLifecycleHooks("agent_switch", context, {
                    threadId: context.threadId,
                    agentName: currentAgent,
                    payload: {
                      fromAgent: previousAgent,
                      toAgent: currentAgent,
                    },
                  });

                  await runLifecycleHooks("subagent_stop", context, {
                    threadId: context.threadId,
                    subagentName: previousAgent,
                    subagentType: previousAgent,
                    payload: { eventType: "subagent_stop" },
                  });

                  await runLifecycleHooks("subagent_start", context, {
                    threadId: context.threadId,
                    subagentName: currentAgent,
                    subagentType: currentAgent,
                    payload: { eventType: "subagent_start" },
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
              // Output sanitization is now handled by GordonOutputSanitizer processor
              if (chunk.payload?.text) {
                fullText += chunk.payload.text;
                yield {
                  type: "text_delta",
                  content: chunk.payload.text,
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
                  fullText += innerPayload.payload.text;
                  yield {
                    type: "text_delta",
                    content: innerPayload.payload.text,
                    agentName: currentAgent,
                  };
                } else if (innerType === "tool-call" && innerPayload?.payload?.toolName) {
                  const toolName = innerPayload.payload.toolName;
                  const detectedAgent = getAgentForTool(toolName);
                  const loopState = recordToolCallFingerprint(
                    context,
                    toolName,
                    innerPayload.payload.args ?? {},
                  );
                  if (loopState.blocked) {
                    yield {
                      type: "error",
                      error: formatRecoveryGuidance({
                        category: "policy_block",
                        title: "Repeated tool loop blocked",
                        detail: `${toolName} was invoked ${loopState.count} times with the same arguments in a short window.`,
                        nextSteps: [
                          "Revise the request or narrow the scope before retrying.",
                          "Check whether the active venue or provider is causing the repeated fallback loop.",
                        ],
                      }),
                    };
                    resetLoopSignals(context);
                    return;
                  }

                  const compiledProfiles = getCompiledSubagentProfiles();
                  if (detectedAgent && !isToolAllowedForAgent(compiledProfiles, detectedAgent, toolName)) {
                    yield {
                      type: "error",
                      error: formatRecoveryGuidance({
                        category: "policy_block",
                        title: "Tool blocked by subagent profile",
                        detail: `${toolName} is not allowed for the compiled ${detectedAgent} tool profile.`,
                        nextSteps: [
                          "Retry with a narrower request or a different task scope.",
                          "If this is a real capability gap, update the routed tool map rather than bypassing profile isolation.",
                        ],
                      }),
                    };
                    return;
                  }

                  const securityCheck = await checkToolSecurity(
                    detectedAgent || currentAgent || "Gordon",
                    toolName,
                    context
                  );
                  if (!securityCheck.allowed) {
                    const reason = securityCheck.error || `Blocked tool call: ${toolName}`;
                    yield { type: "error", error: reason };
                    return;
                  }

                  if (requiresPlanningArtifact(toolName)) {
                    const symbol = typeof innerPayload.payload.args?.symbol === "string"
                      ? innerPayload.payload.args.symbol
                      : undefined;
                    const readiness = getExecutionReadiness(context, symbol);
                    if (!readiness.ready) {
                      yield {
                        type: "error",
                        error: formatRecoveryGuidance({
                          category: "approval_required",
                          title: "Execution phase blocked",
                          detail: readiness.reason ?? "Execution requires a recent plan or preview.",
                          nextSteps: [
                            "Run a plan or preview step first in this thread.",
                            "Then retry the live execution step once the plan is explicit.",
                          ],
                        }),
                      };
                      return;
                    }
                  }

                  if (detectedAgent && detectedAgent !== currentAgent) {
                    const previousAgent = currentAgent || "Gordon";
                    currentAgent = detectedAgent;

                    // Track the handoff
                    await trackHandoff(previousAgent, currentAgent, {
                      toolName,
                      toolArgs: innerPayload.payload.args,
                      handoffBudget:
                        currentAgent === "Executor"
                          ? buildDefaultExecutorHandoffBudget(context, innerPayload.payload.args)
                          : undefined,
                      eventType: "agent-execution-event",
                      mode: context.config?.mode,
                    });

                    await runLifecycleHooks("agent_switch", context, {
                      threadId: context.threadId,
                      agentName: currentAgent,
                      payload: {
                        fromAgent: previousAgent,
                        toAgent: currentAgent,
                      },
                    });

                    yield {
                      type: "agent_switch",
                      agentName: currentAgent,
                    };
                  }
                  const hookResult = await runLifecycleHooks("tool_call_start", context, {
                    threadId: context.threadId,
                    agentName: currentAgent,
                    toolName,
                    payload: innerPayload.payload.args,
                  });
                  if (hookResult.blocked) {
                    yield { type: "error", error: hookResult.reason ?? `Tool blocked before start: ${toolName}` };
                    return;
                  }

                  yield {
                    type: "tool_call_start",
                    toolName,
                    toolArgs: innerPayload.payload.args,
                    agentName: currentAgent,
                  };
                } else if (innerType === "tool-result") {
                  // Capture tool result — if the sub-agent never emits text-delta after
                  // this, we use lastSubAgentToolResult to synthesize a response.
                  const toolResult = innerPayload?.payload?.result;
                  if (isPlanningArtifactTool(innerPayload?.payload?.toolName)) {
                    registerPlanningArtifactFromResult(
                      context,
                      innerPayload?.payload?.toolName ?? "tool",
                      toolResult,
                    );
                  }
                  const optimizedToolResult = await optimizeToolResultForContext(
                    context,
                    innerPayload?.payload?.toolName || "tool",
                    toolResult,
                  );
                  await runLifecycleHooks("tool_call_end", context, {
                    threadId: context.threadId,
                    agentName: currentAgent,
                    toolName: innerPayload?.payload?.toolName,
                    payload: {
                      optimized: optimizedToolResult.offloaded,
                      scratchFile: optimizedToolResult.scratchFile,
                    },
                  });
                  if (toolResult) {
                    lastSubAgentToolResult = {
                      toolName: innerPayload?.payload?.toolName || "unknown",
                      result: optimizedToolResult.result,
                      agent: currentAgent,
                    };
                  }
                  yield {
                    type: "tool_call_end",
                    toolName: innerPayload?.payload?.toolName,
                    toolResult: optimizedToolResult.result,
                    agentName: currentAgent,
                  };
                }
              }
              break;
          }
        }
      } finally {
        reader.releaseLock();
        // Fire subagent_stop for the last active sub-agent when the stream ends
        if (currentAgent && currentAgent.toLowerCase() !== "gordon") {
          await runLifecycleHooks("subagent_stop", context, {
            threadId: context.threadId,
            subagentName: currentAgent,
            subagentType: currentAgent,
            payload: { eventType: "subagent_stop_stream_end" },
          });
        }
      }

    } else if (streamObj.textStream && typeof streamObj.textStream[Symbol.asyncIterator] === 'function') {
      // Fallback to textStream if fullStream is not available
      // Stream text chunks as they arrive
      // OUTPUT GUARDRAIL: Sanitize each chunk for sensitive data
      for await (const chunk of streamObj.textStream) {
        await throwIfStreamAborted(signal);
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
      await throwIfStreamAborted(signal);
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
      await throwIfStreamAborted(signal);
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
    // Limited to 3 attempts to prevent infinite retry loops
    const MAX_TEXT_FALLBACK_ATTEMPTS = 3;
    if (!fullText && streamObj.text) {
      for (let attempt = 0; attempt < MAX_TEXT_FALLBACK_ATTEMPTS; attempt++) {
        await throwIfStreamAborted(signal);
        logger.debug("Attempting final text fallback", { attempt: attempt + 1, maxAttempts: MAX_TEXT_FALLBACK_ATTEMPTS });
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
            logger.debug("Got text from final fallback", { textLength: fullText.length, attempt: attempt + 1 });
            break;
          }
        } catch (textError) {
          logger.error("Failed to get text from fallback", textError as Error);
        }
      }
    }

    // Get usage stats
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (streamObj.usage) {
      await throwIfStreamAborted(signal);
      const usageData = streamObj.usage instanceof Promise ? await streamObj.usage : streamObj.usage;
      usage = {
        promptTokens: usageData.inputTokens || 0,
        completionTokens: usageData.outputTokens || 0,
        totalTokens: usageData.totalTokens || 0,
      };
    }
    recordPromptUsage(context, threadId, usage);

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

    // Handle empty response — synthesize from sub-agent tool results if available
    if (!fullText || fullText.trim().length === 0) {
      if (lastSubAgentToolResult) {
        // Mastra didn't emit text-delta after the sub-agent tool call.
        // Synthesize a human-readable response from the tool result.
        try {
          const { toolName, result } = lastSubAgentToolResult;
          const resultObj = typeof result === "string" ? JSON.parse(result) : result;
          const resultData = (resultObj as Record<string, unknown>)?.result ?? resultObj;

          if ((resultData as Record<string, unknown>)?.success === false) {
            fullText = `Tool ${toolName} failed: ${(resultData as Record<string, unknown>)?.error || "Unknown error"}`;
          } else {
            // Format the result as readable text for the user
            fullText = JSON.stringify(resultData, null, 2);
          }
        } catch {
          fullText = String(lastSubAgentToolResult.result);
        }

        logger.info("Synthesized response from sub-agent tool result", {
          toolName: lastSubAgentToolResult.toolName,
          agent: lastSubAgentToolResult.agent,
          responseLength: fullText.length,
        });
      } else {
        logger.warn("Stream completed with empty content", {
          userMessage: userMessage.substring(0, 100),
          hasFullStream: !!streamObj.fullStream,
          hasTextStream: !!streamObj.textStream,
          textType: typeof streamObj.text,
        });
        fullText = formatRecoveryGuidance(
          classifyRecoveryGuidance(
            "empty_response",
            context,
            { emptyResponse: true, phase: workflowPhase, currentAgent },
          ),
        );
      }
      yield {
        type: "text_delta",
        content: fullText,
        agentName: currentAgent,
      };
    }

    yield {
      type: "done",
      content: fullText,
      usage,
      agentName: currentAgent,
    };
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      agentName: currentAgent,
      userMessage,
      response: fullText,
      payload: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    });

  } catch (err) {
    if (err instanceof StreamCancelledError) {
      logger.info("Streaming cancelled by user", {
        messageLength: userMessage.length,
      });
      yield {
        type: "cancelled",
        content: err.message,
      };
      resetLoopSignals(context);
      return;
    }

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
      error: formatRecoveryGuidance(
        classifyRecoveryGuidance(error, context, {
          phase: workflowPhase,
          currentAgent,
        }),
      ),
    };
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      agentName: currentAgent,
      userMessage,
      error: error.message,
      payload: {
        failed: true,
      },
    });
  }
}

// ============================================================================
// Agent Network Processing (SOTA Multi-Agent)
// ============================================================================

// ============================================================================
// Structured Output Processing (Mastra structuredOutput API)
// ============================================================================

/**
 * Process a message and return typed structured output via Mastra's structuredOutput API.
 *
 * Uses gordonAgent().generate() with a Zod schema to get back a validated object
 * instead of free-text. Ideal for:
 * - Gateway/API responses that need machine-readable data
 * - Autonomous event processing where downstream code needs typed decisions
 * - Export functionality requiring structured data
 *
 * @param userMessage - The user's input message
 * @param schema - Zod schema defining the expected response structure
 * @param context - Gordon's context
 * @param threadId - Thread ID for conversation persistence
 * @param resourceId - Resource/user ID for memory association
 */
export async function processStructuredMessage<T extends Record<string, unknown>>(
  userMessage: string,
  schema: z.ZodSchema<T>,
  context: GordonContext,
  threadId?: string,
  resourceId?: string,
): Promise<{
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}> {
  const startTime = Date.now();
  logger.debug("Processing structured message", { messageLength: userMessage.length });

  const requestContext = createRequestContext(context);
  const tracingOptions = createAgentTracingOptions();
  const effectiveResourceId = resourceId || context.userId || "default";

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    const result = await gordonAgent().generate(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: { thread: threadId, resource: effectiveResourceId },
      } : {}),
      maxSteps: 20,
      structuredOutput: { schema },
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as {
      object?: T;
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

    if (!resultObj.object) {
      throw new Error("Agent did not return structured output");
    }

    recordRequest(Date.now() - startTime, true);

    const usage = resultObj.usage ?? {};
    const normalizedUsage = {
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    };
    recordPromptUsage(context, threadId, normalizedUsage);
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      userMessage,
      payload: {
        structured: true,
        promptTokens: normalizedUsage.promptTokens,
        completionTokens: normalizedUsage.completionTokens,
        totalTokens: normalizedUsage.totalTokens,
      },
    });
    return {
      data: resultObj.object,
      usage: normalizedUsage,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Structured message processing error", error);
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "StructuredOutputError");
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      userMessage,
      error: error.message,
      payload: {
        structured: true,
        failed: true,
      },
    });
    throw new Error(
      formatRecoveryGuidance(
        classifyRecoveryGuidance(error, context, {
          phase: determineWorkflowPhase(context),
        }),
      ),
    );
  }
}

// ============================================================================
// Network Processing
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

  // Input guardrails are now handled by GordonInputGuard processor (registered on all agents)
  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    await emitEvent("agent:started", { agent: "gordon-network" });

    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use Agent Network for automatic routing between sub-agents
    // Pass threadId and resourceId inside memory option for Mastra's network execution path
    // This ensures sub-agents also receive thread/resource context for working memory updates
    const effectiveResourceId = resourceId || context.userId || "default";
    const networkResult = await gordonAgent().network(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: {
          thread: threadId,
          resource: effectiveResourceId,
        },
      } : {}),
      maxSteps: 30,
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

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

    // Output sanitization is now handled by GordonOutputSanitizer processor

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
    recordPromptUsage(context, threadId, usage);
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      userMessage,
      response: fullText,
      payload: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        network: true,
      },
    });

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
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      userMessage,
      error: error.message,
      payload: {
        network: true,
        failed: true,
      },
    });

    yield {
      type: "error",
      error: formatRecoveryGuidance(
        classifyRecoveryGuidance(error, context, {
          phase: determineWorkflowPhase(context),
        }),
      ),
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

  // Input guardrails are now handled by GordonInputGuard processor (registered on all agents)
  const requestContext = createRequestContext(context);

  try {
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    // Use generate() for non-streaming responses
    // Pass threadId and resourceId inside memory option for Mastra's newer execution path
    // This ensures sub-agents also receive thread/resource context for working memory updates
    const effectiveResourceId = resourceId || context.userId || "default";
    const result = await gordonAgent().generate(groundedPrompt.messages, {
      requestContext,
      ...(threadId && effectiveResourceId ? {
        memory: {
          thread: threadId,
          resource: effectiveResourceId,
        },
      } : {}),
      maxSteps: 20,
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    // Extract text from result - Mastra returns { text, usage, ... }
    const resultObj = result as unknown as {
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };

    // Output sanitization is now handled by GordonOutputSanitizer processor
    const response = resultObj.text || "I'm not sure how to help with that.";

    // Emit event for tracking
    await emitEvent("agent:message_processed", {
      userMessage: userMessage.substring(0, 100),
      responseLength: response.length,
      historyLength: 0, // Not tracking history length in this context
    });

    logger.debug("Message processed", { responseLength: response.length });

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);

    const usage = {
      promptTokens: resultObj.usage?.inputTokens || 0,
      completionTokens: resultObj.usage?.outputTokens || 0,
      totalTokens: resultObj.usage?.totalTokens || 0,
    };
    recordPromptUsage(context, threadId, usage);
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      userMessage,
      response,
      payload: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      },
    });

    return {
      response,
      usage,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("Failed to process message", error);

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");
    await finalizeAfterRequest(context, {
      threadId: threadId ?? context.threadId,
      userMessage,
      error: error.message,
      payload: {
        failed: true,
      },
    });

    throw new Error(
      formatRecoveryGuidance(
        classifyRecoveryGuidance(error, context, {
          phase: determineWorkflowPhase(context),
        }),
      ),
    );
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
    const groundedPrompt = await buildGroundedPrompt(userMessage, context, requestContext);
    // Build tracing options if tracing is enabled
    const tracingOptions = createAgentTracingOptions();

    const result = await gordonAgent().generate(groundedPrompt.messages, {
      requestContext,
      maxSteps: 5, // Limit steps for simple queries
      ...groundedPrompt.requestOptions,
      ...(tracingOptions && { tracingOptions }),
    });

    const resultObj = result as unknown as {
      text?: string;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    };
    const rawResponse = resultObj.text || "I'm not sure how to help with that.";

    // OUTPUT GUARDRAIL: Sanitize response for sensitive data
    const outputCheck = await checkOutputGuardrails(rawResponse);

    // Record successful request metrics
    recordRequest(Date.now() - startTime, true);
    recordPromptUsage(context, context.threadId, {
      promptTokens: resultObj.usage?.inputTokens || 0,
      completionTokens: resultObj.usage?.outputTokens || 0,
      totalTokens: resultObj.usage?.totalTokens || 0,
    });
    await finalizeAfterRequest(context, {
      threadId: context.threadId,
      userMessage,
      response: outputCheck.sanitized,
      payload: {
        simple: true,
      },
    });

    return outputCheck.sanitized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // Record failed request metrics
    recordRequest(Date.now() - startTime, false);
    recordError(error.name || "UnknownError");
    await finalizeAfterRequest(context, {
      threadId: context.threadId,
      userMessage,
      error: error.message,
      payload: {
        simple: true,
        failed: true,
      },
    });

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
export async function initializeTracing(): Promise<void> {
  // Initialize the tracing module
  await initTracingModule();

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

  const policyResult = await evaluateToolRequestPolicy(toolName, context);
  if (!policyResult.allowed) {
    auditLog.record(
      userId,
      "ACCESS_DENIED",
      {
        agentName,
        toolName,
        requestedActionId: context.requestedActionId,
        requestedTaskScope: context.requestedTaskScope,
      },
      "BLOCKED",
      { resultDetails: policyResult.reason }
    );

    return {
      allowed: false,
      error: policyResult.reason,
    };
  }

  // Check access control (ARMED mode for trading tools)
  let accessResult = await checkToolAccess(toolName, context.config, userId);
  if (!accessResult.allowed) {
    return {
      allowed: false,
      error: accessResult.reason,
      accessControlResult: accessResult,
    };
  }

  if (policyResult.requiresArmedMode && !requiresArmedModeForTool(toolName)) {
    accessResult = await checkExplicitExecutionAccess(toolName, context.config, userId);
    if (!accessResult.allowed) {
      return {
        allowed: false,
        error: accessResult.reason,
        accessControlResult: accessResult,
      };
    }
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
