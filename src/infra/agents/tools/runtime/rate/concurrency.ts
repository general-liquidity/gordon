/**
 * Tool Concurrency Classification + Streaming Executor
 *
 * Each tool is tagged as concurrent-safe (read-only, idempotent) or
 * non-concurrent (state-changing, order placement). The StreamingToolExecutor
 * runs safe tools in parallel and serializes unsafe ones.
 *
 * Claude Code pattern: tools tagged with isConcurrencySafe run up to N in
 * parallel; non-concurrent tools get exclusive access. Progress messages
 * stream immediately while results buffer in arrival order.
 */

import { emitAgentEvent } from "../../../streaming/coordinator.ts";
import { createEvent } from "../../../streaming/events.ts";

// ============================================================================
// Concurrency Classification
// ============================================================================

/**
 * Tools that are safe to run in parallel — read-only, idempotent, no side effects.
 * Includes all market data, analysis, account reads, and informational tools.
 */
const CONCURRENT_SAFE_TOOLS = new Set([
  // Market data (re-fetchable)
  "get_price", "get_prices", "get_ticker", "get_candles", "get_orderbook",
  "get_book_ticker", "get_spread", "get_24hr_tickers", "get_top_symbols",
  "get_exchange_info", "get_avg_price", "get_historical_klines",
  // Scanning / discovery
  "scan_market", "scan_top_movers", "scan_trending", "check_regime",
  "scan_setups", "detect_patterns",
  // Analysis (re-computable)
  "analyze_symbol", "analyze_pair", "compute_indicators", "compare_exchanges",
  "evaluate_portfolio", "explain_indicator", "get_indicator_state",
  // Account reads
  "get_portfolio", "get_account_details", "get_account_snapshot",
  "get_balance", "get_all_balances", "get_wallet_balances",
  "get_open_orders", "get_order_status", "get_trade_history",
  "get_order_history", "get_transfer_history",
  // Earn reads
  "get_flexible_earn_products", "get_locked_earn_products", "get_all_earn_positions",
  "get_earn_history",
  // Risk reads
  "check_exit_conditions", "check_drawdown_status", "check_daily_limit",
  // System reads
  "test_connection", "get_system_status", "get_cache_stats",
  "read_shared_context", "search_memory", "memory_get",
  // Backtest reads
  "backtest_strategy", "list_strategies", "get_backtest_results",
  // Data sources
  "get_fundamentals", "get_insider_trades", "get_segments", "screen_stocks",
  "search_x", "get_sec_filings", "get_news",
  // Preview (no side effects)
  "preview_market_order", "preview_withdrawal",
  // Solana reads
  "solana_get_balance", "solana_get_tps", "solana_get_token_data",
  "solana_price", "solana_token_data_by_ticker",
  // Polkadot reads
  "polkadot_get_balance", "polkadot_get_staking_info",
]);

/**
 * Check if a tool can be safely executed alongside other tools.
 */
export function isConcurrencySafe(toolName: string): boolean {
  return CONCURRENT_SAFE_TOOLS.has(toolName);
}

/**
 * Classify a batch of tool calls into parallel-safe and serial groups.
 */
export function classifyBatch(toolNames: string[]): {
  parallel: string[];
  serial: string[];
} {
  const parallel: string[] = [];
  const serial: string[] = [];
  for (const name of toolNames) {
    if (isConcurrencySafe(name)) parallel.push(name);
    else serial.push(name);
  }
  return { parallel, serial };
}

// ============================================================================
// Streaming Tool Executor
// ============================================================================

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  execute: () => Promise<unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  success: boolean;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface ExecutorOptions {
  /** Max concurrent-safe tools to run in parallel. Default 6. */
  maxConcurrency?: number;
  /** Iteration counter for event emission. */
  iteration?: number;
  /** Abort signal to cancel all pending tools. */
  signal?: AbortSignal;
}

/**
 * Execute a batch of tool calls respecting concurrency classification.
 * Concurrent-safe tools run in parallel (up to maxConcurrency).
 * Non-concurrent tools run serially after all parallel tools finish.
 * Results are returned in the original submission order.
 *
 * Yields progress events via AgentEventStream.
 */
export async function executeToolBatch(
  tools: ToolCall[],
  options: ExecutorOptions = {},
): Promise<ToolResult[]> {
  const maxConcurrency = options.maxConcurrency ?? 6;
  const iteration = options.iteration ?? 0;

  const { parallel, serial } = classifyToolCalls(tools);
  const resultMap = new Map<string, ToolResult>();

  // Phase 1: Run concurrent-safe tools in parallel with concurrency limit
  if (parallel.length > 0) {
    await runParallel(parallel, maxConcurrency, iteration, resultMap, options.signal);
  }

  // Phase 2: Run non-concurrent tools serially
  for (const tool of serial) {
    if (options.signal?.aborted) break;
    const result = await executeSingle(tool, iteration);
    resultMap.set(tool.id, result);
  }

  // Return in original submission order
  return tools.map((t) => resultMap.get(t.id)!).filter(Boolean);
}

function classifyToolCalls(tools: ToolCall[]): { parallel: ToolCall[]; serial: ToolCall[] } {
  const parallel: ToolCall[] = [];
  const serial: ToolCall[] = [];
  for (const tool of tools) {
    if (isConcurrencySafe(tool.name)) parallel.push(tool);
    else serial.push(tool);
  }
  return { parallel, serial };
}

async function runParallel(
  tools: ToolCall[],
  maxConcurrency: number,
  iteration: number,
  resultMap: Map<string, ToolResult>,
  signal?: AbortSignal,
): Promise<void> {
  let idx = 0;
  const running: Promise<void>[] = [];

  while (idx < tools.length) {
    if (signal?.aborted) break;

    while (running.length < maxConcurrency && idx < tools.length) {
      const tool = tools[idx++]!;
      const promise = executeSingle(tool, iteration).then((result) => {
        resultMap.set(tool.id, result);
      });
      running.push(promise);
    }

    // Wait for at least one to finish before adding more
    if (running.length >= maxConcurrency) {
      await Promise.race(running);
      // Remove settled promises
      const settled = running.filter((p) => {
        let done = false;
        p.then(() => { done = true; }, () => { done = true; });
        return done;
      });
      for (const s of settled) {
        const idx = running.indexOf(s);
        if (idx !== -1) running.splice(idx, 1);
      }
    }
  }

  // Wait for remaining
  await Promise.allSettled(running);
}

async function executeSingle(tool: ToolCall, iteration: number): Promise<ToolResult> {
  emitAgentEvent(createEvent("tool_start", iteration, {
    toolName: tool.name,
    toolCallId: tool.id,
    args: tool.args,
  }));

  const start = Date.now();
  try {
    const result = await tool.execute();
    const durationMs = Date.now() - start;

    emitAgentEvent(createEvent("tool_end", iteration, {
      toolName: tool.name,
      toolCallId: tool.id,
      success: true,
      durationMs,
      resultPreview: typeof result === "string" ? result.slice(0, 200) : JSON.stringify(result).slice(0, 200),
    }));

    return { id: tool.id, name: tool.name, success: true, result, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);

    emitAgentEvent(createEvent("tool_end", iteration, {
      toolName: tool.name,
      toolCallId: tool.id,
      success: false,
      durationMs,
    }));

    emitAgentEvent(createEvent("error", iteration, {
      message: `Tool ${tool.name} failed: ${errorMsg}`,
      recoverable: true,
    }));

    return { id: tool.id, name: tool.name, success: false, result: null, durationMs, error: errorMsg };
  }
}
