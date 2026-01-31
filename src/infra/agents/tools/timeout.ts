/**
 * Tool Timeout Handling
 *
 * Provides timeout wrapper for agent tools to prevent long-running operations
 * from blocking the agent. Features:
 * - Per-tool timeout configuration
 * - Return partial results on timeout if available
 * - Graceful timeout handling with user-friendly messages
 * - Configurable default timeouts by tool category
 *
 * Usage:
 * - Use withTimeout() to wrap tool executors with timeout handling
 * - Configure timeouts per-tool using TOOL_TIMEOUT_CONFIG
 * - Override default timeouts with custom values
 */

import type { MastraExecutionContext } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Tool executor function signature
 */
export type ToolExecutor<TInput, TOutput> = (
  input: TInput,
  context?: MastraExecutionContext
) => Promise<TOutput>;

/**
 * Timeout configuration for a tool
 */
export interface ToolTimeoutConfig {
  /** Timeout in milliseconds */
  timeout: number;
  /** Message to show on timeout */
  timeoutMessage?: string;
  /** Whether to return partial results if available */
  returnPartialOnTimeout?: boolean;
}

/**
 * Result type for timeout wrapper
 */
export interface TimeoutResult<T> {
  /** Whether the operation completed successfully */
  completed: boolean;
  /** The result if completed */
  result?: T;
  /** Whether the operation timed out */
  timedOut: boolean;
  /** Partial result if available on timeout */
  partialResult?: Partial<T>;
  /** Error message if timed out */
  error?: string;
  /** Actual execution time in ms */
  executionTime: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default timeout in milliseconds (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// Per-Tool Timeout Configuration
// ============================================================================

/**
 * Pre-configured timeout settings by tool ID
 *
 * Guidelines:
 * - backtest: Long timeout (60s) - computationally expensive
 * - optimization: Very long timeout (120s) - many iterations
 * - scan: Medium timeout (30s) - scans many coins
 * - analysis: Short timeout (15s) - single coin analysis
 * - indicators: Short timeout (10s) - simple calculations
 * - account: Short timeout (10s) - API calls
 * - trading: Medium timeout (30s) - order placement
 */
export const TOOL_TIMEOUT_CONFIG: Record<string, ToolTimeoutConfig> = {
  // Backtest tools - long operations
  run_backtest: {
    timeout: 60_000,
    timeoutMessage:
      "Backtest operation timed out after 60 seconds. Try reducing the number of days or using a larger timeframe.",
    returnPartialOnTimeout: true,
  },
  optimize_strategy: {
    timeout: 120_000,
    timeoutMessage:
      "Strategy optimization timed out after 120 seconds. Try reducing the number of parameter combinations.",
    returnPartialOnTimeout: true,
  },
  compare_backtests: {
    timeout: 90_000,
    timeoutMessage: "Backtest comparison timed out after 90 seconds. Try comparing fewer strategies.",
    returnPartialOnTimeout: true,
  },

  // Market scanning tools - medium operations
  scan_market: {
    timeout: 30_000,
    timeoutMessage: "Market scan timed out after 30 seconds. Try scanning fewer coins (reduce topN).",
    returnPartialOnTimeout: true,
  },
  detect_whale_activity: {
    timeout: 30_000,
    timeoutMessage: "Whale detection timed out after 30 seconds.",
    returnPartialOnTimeout: false,
  },
  scan_breakouts: {
    timeout: 30_000,
    timeoutMessage: "Breakout scan timed out after 30 seconds.",
    returnPartialOnTimeout: true,
  },
  find_consolidating_coins: {
    timeout: 30_000,
    timeoutMessage: "Consolidation scan timed out after 30 seconds.",
    returnPartialOnTimeout: true,
  },

  // Analysis tools - short-medium operations
  analyze_coin: {
    timeout: 15_000,
    timeoutMessage: "Coin analysis timed out after 15 seconds. The exchange may be experiencing delays.",
    returnPartialOnTimeout: false,
  },
  score_trading_opportunity: {
    timeout: 15_000,
    timeoutMessage: "Opportunity scoring timed out after 15 seconds.",
    returnPartialOnTimeout: false,
  },

  // Technical indicator tools - fast operations
  get_rsi: {
    timeout: 10_000,
    timeoutMessage: "RSI calculation timed out. The exchange may be experiencing delays.",
    returnPartialOnTimeout: false,
  },
  get_macd: {
    timeout: 10_000,
    timeoutMessage: "MACD calculation timed out. The exchange may be experiencing delays.",
    returnPartialOnTimeout: false,
  },
  get_bollinger_bands: {
    timeout: 10_000,
    timeoutMessage: "Bollinger Bands calculation timed out. The exchange may be experiencing delays.",
    returnPartialOnTimeout: false,
  },
  get_technical_analysis: {
    timeout: 15_000,
    timeoutMessage: "Technical analysis timed out. The exchange may be experiencing delays.",
    returnPartialOnTimeout: false,
  },
  get_volume_profile: {
    timeout: 15_000,
    timeoutMessage: "Volume profile calculation timed out.",
    returnPartialOnTimeout: false,
  },
  get_support_resistance: {
    timeout: 10_000,
    timeoutMessage: "Support/resistance calculation timed out.",
    returnPartialOnTimeout: false,
  },

  // Trading tools - medium timeout for order operations
  create_plan: {
    timeout: 20_000,
    timeoutMessage: "Plan creation timed out. Please try again.",
    returnPartialOnTimeout: false,
  },
  create_grid_plan: {
    timeout: 20_000,
    timeoutMessage: "Grid plan creation timed out. Please try again.",
    returnPartialOnTimeout: false,
  },
  execute_plan: {
    timeout: 30_000,
    timeoutMessage: "Plan execution timed out. Check your orders on the exchange.",
    returnPartialOnTimeout: false,
  },
  close_trade: {
    timeout: 30_000,
    timeoutMessage: "Trade closure timed out. Check your positions on the exchange.",
    returnPartialOnTimeout: false,
  },

  // Account tools - fast API calls
  get_account_balance: {
    timeout: 10_000,
    timeoutMessage: "Account balance fetch timed out. The exchange may be experiencing delays.",
    returnPartialOnTimeout: false,
  },
  get_trade_history: {
    timeout: 15_000,
    timeoutMessage: "Trade history fetch timed out.",
    returnPartialOnTimeout: true,
  },
  get_transfer_history: {
    timeout: 15_000,
    timeoutMessage: "Transfer history fetch timed out.",
    returnPartialOnTimeout: true,
  },

  // Order book tools - fast operations
  get_order_book: {
    timeout: 10_000,
    timeoutMessage: "Order book fetch timed out.",
    returnPartialOnTimeout: false,
  },
  analyze_order_book: {
    timeout: 10_000,
    timeoutMessage: "Order book analysis timed out.",
    returnPartialOnTimeout: false,
  },

  // Charts - medium timeout
  show_price_chart: {
    timeout: 15_000,
    timeoutMessage: "Chart generation timed out.",
    returnPartialOnTimeout: false,
  },

  // Strategy tools
  detect_strategy: {
    timeout: 15_000,
    timeoutMessage: "Strategy detection timed out.",
    returnPartialOnTimeout: false,
  },
  scan_for_strategies: {
    timeout: 45_000,
    timeoutMessage: "Strategy scan timed out. Try scanning fewer coins.",
    returnPartialOnTimeout: true,
  },
  suggest_strategies: {
    timeout: 20_000,
    timeoutMessage: "Strategy suggestion timed out.",
    returnPartialOnTimeout: false,
  },

  // Risk management tools
  calculate_kelly_size: {
    timeout: 5_000,
    timeoutMessage: "Kelly sizing calculation timed out.",
    returnPartialOnTimeout: false,
  },
  check_daily_risk_limits: {
    timeout: 10_000,
    timeoutMessage: "Risk limit check timed out.",
    returnPartialOnTimeout: false,
  },
  analyze_drawdown_risk: {
    timeout: 10_000,
    timeoutMessage: "Drawdown analysis timed out.",
    returnPartialOnTimeout: false,
  },
};

// ============================================================================
// Timeout Functions
// ============================================================================

/**
 * Create a promise that rejects after a timeout
 *
 * @param ms - Timeout in milliseconds
 * @param message - Error message on timeout
 * @returns Promise that rejects on timeout
 */
function createTimeoutPromise(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
}

/**
 * Execute a function with a timeout
 *
 * @param fn - Function to execute
 * @param timeout - Timeout in milliseconds
 * @param timeoutMessage - Message to show on timeout
 * @returns Result with timeout information
 */
export async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeout: number,
  timeoutMessage = "Operation timed out"
): Promise<TimeoutResult<T>> {
  const startTime = Date.now();

  try {
    const result = await Promise.race([fn(), createTimeoutPromise(timeout, timeoutMessage)]);

    return {
      completed: true,
      result,
      timedOut: false,
      executionTime: Date.now() - startTime,
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    const isTimeout =
      error instanceof Error && (error.message === timeoutMessage || executionTime >= timeout);

    if (isTimeout) {
      return {
        completed: false,
        timedOut: true,
        error: timeoutMessage,
        executionTime,
      };
    }

    // Re-throw non-timeout errors
    throw error;
  }
}

// ============================================================================
// Wrapper Functions
// ============================================================================

/**
 * Wrap a tool executor with timeout handling
 *
 * If the tool times out, returns an error object with timeout information.
 * Can optionally return partial results if available.
 *
 * @param toolName - Name of the tool (for config lookup)
 * @param executor - The original tool executor
 * @param config - Optional timeout configuration (overrides TOOL_TIMEOUT_CONFIG)
 * @returns Wrapped executor with timeout handling
 *
 * @example
 * ```typescript
 * const timedOutExecutor = withTimeout(
 *   "run_backtest",
 *   originalExecutor,
 *   { timeout: 60000 }
 * );
 * ```
 */
export function withTimeout<TInput, TOutput>(
  toolName: string,
  executor: ToolExecutor<TInput, TOutput>,
  config?: Partial<ToolTimeoutConfig>
): ToolExecutor<TInput, TOutput | { error: string; timedOut: true; executionTime: number }> {
  // Merge configurations: provided config > tool-specific > defaults
  const toolConfig = TOOL_TIMEOUT_CONFIG[toolName];
  const finalConfig: ToolTimeoutConfig = {
    timeout: config?.timeout ?? toolConfig?.timeout ?? DEFAULT_TIMEOUT_MS,
    timeoutMessage:
      config?.timeoutMessage ??
      toolConfig?.timeoutMessage ??
      `${toolName} timed out after ${(config?.timeout ?? toolConfig?.timeout ?? DEFAULT_TIMEOUT_MS) / 1000} seconds.`,
    returnPartialOnTimeout:
      config?.returnPartialOnTimeout ?? toolConfig?.returnPartialOnTimeout ?? false,
  };

  return async function timedExecutor(
    input: TInput,
    context?: MastraExecutionContext
  ): Promise<TOutput | { error: string; timedOut: true; executionTime: number }> {
    const result = await executeWithTimeout(
      () => executor(input, context),
      finalConfig.timeout,
      finalConfig.timeoutMessage
    );

    if (result.completed && result.result !== undefined) {
      return result.result;
    }

    // Handle timeout
    if (result.timedOut) {
      return {
        error: result.error ?? finalConfig.timeoutMessage ?? "Operation timed out",
        timedOut: true as const,
        executionTime: result.executionTime,
      };
    }

    // Should not reach here, but handle gracefully
    return {
      error: "Unknown error occurred",
      timedOut: true as const,
      executionTime: result.executionTime,
    };
  };
}

/**
 * Get timeout configuration for a tool
 *
 * @param toolId - Tool identifier
 * @returns Timeout config or default if none configured
 */
export function getToolTimeoutConfig(toolId: string): ToolTimeoutConfig {
  return (
    TOOL_TIMEOUT_CONFIG[toolId] ?? {
      timeout: DEFAULT_TIMEOUT_MS,
      timeoutMessage: `${toolId} timed out after ${DEFAULT_TIMEOUT_MS / 1000} seconds.`,
      returnPartialOnTimeout: false,
    }
  );
}

/**
 * Check if a result indicates a timeout
 *
 * @param result - Tool result
 * @returns Whether the result indicates a timeout
 */
export function isTimeoutResult(result: unknown): result is { error: string; timedOut: true } {
  return (
    result !== null &&
    typeof result === "object" &&
    "timedOut" in result &&
    (result as { timedOut: unknown }).timedOut === true
  );
}

/**
 * Get remaining time before timeout
 *
 * @param toolId - Tool identifier
 * @param elapsedMs - Elapsed time in milliseconds
 * @returns Remaining time in milliseconds, or 0 if already timed out
 */
export function getRemainingTimeout(toolId: string, elapsedMs: number): number {
  const config = getToolTimeoutConfig(toolId);
  return Math.max(0, config.timeout - elapsedMs);
}

/**
 * Format timeout duration for display
 *
 * @param ms - Duration in milliseconds
 * @returns Human-readable duration string
 */
export function formatTimeoutDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}
