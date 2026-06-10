/**
 * Tool Concurrency Classification
 *
 * Classifies every tool as read-safe (can run concurrently with other
 * read-safe tools) or write-serial (must run exclusively). Inspired by
 * Claude Code's `partitionToolCalls()` pattern — safe tools are batched
 * for concurrent execution, serial tools require exclusive access.
 *
 * Classification used by:
 * - Future speculative execution (pre-launch tools during model streaming)
 * - Conversation budget per-family limits
 * - Orchestrator concurrency decisions
 */

// ============================================================================
// Types
// ============================================================================

export type ConcurrencySafety = "read_safe" | "write_serial";

export type ToolFamily =
  | "market_data"     // Prices, candles, tickers, orderbook reads
  | "analysis"        // Indicators, charts, scoring, SMC patterns
  | "finnhub"         // All Finnhub endpoints (stocks, crypto, macro)
  | "portfolio_read"  // Account, positions, balances, history (read-only)
  | "risk_read"       // Risk classification, check_risk (non-mutating)
  | "memory_read"     // Search memory, get lessons, shared context reads
  | "discovery"       // Trending, volume movers, DEX search
  | "defi_read"       // DeFi Llama yields and on-chain reads
  | "social"          // X social, news sentiment, social sentiment
  | "regime"          // Regime detection, Hurst, efficiency
  | "backtest"        // Backtests, walk-forward, Monte Carlo
  | "planning"        // Create plans, preview orders (non-executing)
  | "skill"           // Skill listing/loading, calibration reads
  | "audit"           // Audit trail, decision path, metrics
  | "trade_execution" // Place orders, execute plans, approve strategies
  | "transfer"        // Fund transfers, withdrawals
  | "system"          // Arm/disarm, mode changes, scheduler mutations
  | "unknown";

export interface ToolClassification {
  safety: ConcurrencySafety;
  family: ToolFamily;
  /** Max result chars before spill for this family (per-result). */
  maxResultChars: number;
}

// ============================================================================
// Classification Map
// ============================================================================

/**
 * Per-family defaults. Tools not explicitly mapped get classified by
 * prefix matching or fall through to "unknown" (read_safe, 30K limit).
 */
const FAMILY_DEFAULTS: Record<ToolFamily, Omit<ToolClassification, "family">> = {
  market_data:     { safety: "read_safe",     maxResultChars: 80_000 },
  analysis:        { safety: "read_safe",     maxResultChars: 60_000 },
  finnhub:         { safety: "read_safe",     maxResultChars: 80_000 },
  portfolio_read:  { safety: "read_safe",     maxResultChars: 50_000 },
  risk_read:       { safety: "read_safe",     maxResultChars: 30_000 },
  memory_read:     { safety: "read_safe",     maxResultChars: 30_000 },
  discovery:       { safety: "read_safe",     maxResultChars: 60_000 },
  defi_read:       { safety: "read_safe",     maxResultChars: 60_000 },
  social:          { safety: "read_safe",     maxResultChars: 40_000 },
  regime:          { safety: "read_safe",     maxResultChars: 20_000 },
  backtest:        { safety: "read_safe",     maxResultChars: 100_000 },
  planning:        { safety: "read_safe",     maxResultChars: 40_000 },
  skill:           { safety: "read_safe",     maxResultChars: 20_000 },
  audit:           { safety: "read_safe",     maxResultChars: 40_000 },
  trade_execution: { safety: "write_serial",  maxResultChars: 20_000 },
  transfer:        { safety: "write_serial",  maxResultChars: 10_000 },
  system:          { safety: "write_serial",  maxResultChars: 10_000 },
  unknown:         { safety: "read_safe",     maxResultChars: 30_000 },
};

/**
 * Prefix → family mapping. First match wins. Order matters for specificity.
 */
const PREFIX_FAMILY_MAP: Array<[string | RegExp, ToolFamily]> = [
  // Trade execution (write-serial)
  [/^(execute_plan|place_|cancel_order|close_trade|approve_strategy)/, "trade_execution"],
  [/^(transfer_funds|withdraw_to_external|convert_dust)/, "transfer"],
  [/^(arm_|disarm_|start_autonomous|stop_autonomous|pause_autonomous|resume_autonomous)/, "system"],

  // Finnhub (all read-safe)
  [/^(get_(?:upcoming_earnings|earnings_|revenue_|economic_|ipo_|insider_|congressional_|analyst_|price_target|upgrade_|sec_|news_|social_|company_(?:profile|news)|basic_financials|financials_reported|peer_|dividends|stock_(?:quote|candles|symbols|splits)|market_(?:status|news)|pattern_|support_|aggregate_|etf_|mutual_fund_|index_|bond_|finnhub_crypto_|forex_|esg_|fund_ownership|institutional_|lobbying|usa_spending|uspto_|visa_|supply_chain)|symbol_lookup|list_(?:earnings_transcripts|economic_codes)|get_economic_data)/, "finnhub"],

  // Market data
  [/^(get_price|get_ticker|get_candles|get_order_book|get_spread|get_market_trades|get_funding_rate)/, "market_data"],

  // Analysis
  [/^(get_(?:rsi|macd|bollinger|ichimoku|vwap|supertrend|atr|adx|obv|stochastic)|calculate_|detect_smc|analyze_)/, "analysis"],
  [/^(get_chart|render_|generate_chart)/, "analysis"],

  // Discovery
  [/^(scan_|get_trending|get_volume|find_|search_dex|discover_)/, "discovery"],

  // Portfolio reads
  [/^(get_(?:account|positions|balances|portfolio|balance|wallet_address))/, "portfolio_read"],
  [/^(get_trade_history|get_transfer_history|get_historical)/, "portfolio_read"],

  // Risk
  [/^(check_risk|classify_trade_risk|calculate_position_size)/, "risk_read"],
  [/^(get_risk_|evaluate_order_risk)/, "risk_read"],

  // Memory reads
  [/^(search_memory|get_lessons|get_memory_context|read_shared_context)/, "memory_read"],
  [/^(list_recent_decisions|get_calibration_stats)/, "memory_read"],

  // DeFi reads
  [/^(defillama_|get_defi_)/, "defi_read"],

  // Social
  [/^(x_|get_social_|get_news_)/, "social"],

  // Regime
  [/^(detect_regime|get_hurst|get_market_efficiency)/, "regime"],

  // Backtest
  [/^(run_backtest|optimize_strategy|compare_backtests|walkforward|monte_carlo)/, "backtest"],

  // Planning
  [/^(create_plan|create_grid_plan|list_plans|preview_|generate_strategy)/, "planning"],

  // Skills
  [/^(list_skills|load_skill|record_confident|record_decision_outcome|get_producer_health)/, "skill"],

  // Audit
  [/^(query_audit|get_decision_path|get_agent_activity|get_audit_stats|get_runtime_metrics)/, "audit"],

  // Memory writes (read_safe because they don't affect trading state)
  [/^(record_observation|record_insight|write_shared_context|record_trade)/, "memory_read"],
];

// ============================================================================
// API
// ============================================================================

const classificationCache = new Map<string, ToolClassification>();

/**
 * Classify a tool by name. Result is cached for the session.
 */
export function classifyTool(toolName: string): ToolClassification {
  const cached = classificationCache.get(toolName);
  if (cached) return cached;

  let family: ToolFamily = "unknown";
  for (const [pattern, fam] of PREFIX_FAMILY_MAP) {
    const matches = pattern instanceof RegExp ? pattern.test(toolName) : toolName.startsWith(pattern);
    if (matches) {
      family = fam;
      break;
    }
  }

  const defaults = FAMILY_DEFAULTS[family];
  const result: ToolClassification = { safety: defaults.safety, family, maxResultChars: defaults.maxResultChars };
  classificationCache.set(toolName, result);
  return result;
}

/**
 * Check if a tool can run concurrently with other read-safe tools.
 */
export function isToolConcurrentSafe(toolName: string): boolean {
  return classifyTool(toolName).safety === "read_safe";
}

/**
 * Get the per-family result budget for a tool.
 */
export function getToolResultBudget(toolName: string): number {
  return classifyTool(toolName).maxResultChars;
}

/**
 * Partition a list of tool calls into concurrent batches.
 * Consecutive read-safe tools are grouped; a write-serial tool gets its own batch.
 */
export function partitionToolCalls<T extends { toolName: string }>(calls: T[]): T[][] {
  const batches: T[][] = [];
  let currentBatch: T[] = [];

  for (const call of calls) {
    const { safety } = classifyTool(call.toolName);

    if (safety === "write_serial") {
      // Flush current batch
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
      }
      // Serial tool gets its own batch
      batches.push([call]);
    } else {
      currentBatch.push(call);
    }
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

/** Reset classification cache (for tests). */
export function resetClassificationCache(): void {
  classificationCache.clear();
}
