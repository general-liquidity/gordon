/**
 * Per-Tool Rate Limiting
 *
 * Provides rate limiting wrappers for agent tools to prevent:
 * - API rate limit exhaustion
 * - Excessive resource usage
 * - Duplicate rapid requests
 *
 * Features:
 * - Configurable cooldown per tool
 * - Track last call time per tool
 * - User-friendly "please wait" messages
 * - Window-based rate limiting (calls per window)
 *
 * Usage:
 * - Use withRateLimit() to wrap tool executors with rate limiting
 * - Configure limits per-tool using TOOL_RATE_LIMITS
 */

import type { MastraExecutionContext } from "../types.ts";

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
 * Rate limit configuration for a tool
 */
export interface ToolRateLimitConfig {
  /** Minimum time between calls in milliseconds */
  cooldownMs: number;
  /** Maximum calls allowed in the window (optional, for burst limiting) */
  maxCallsPerWindow?: number;
  /** Window size in milliseconds for burst limiting */
  windowMs?: number;
  /** Custom message when rate limited */
  rateLimitMessage?: string;
}

/**
 * Rate limit state for a tool
 */
interface RateLimitState {
  /** Timestamp of last call */
  lastCallTime: number;
  /** Call timestamps within current window (for burst limiting) */
  callsInWindow: number[];
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /** Whether the call is allowed */
  allowed: boolean;
  /** Time to wait before next call (if not allowed) */
  waitTimeMs?: number;
  /** Reason for rate limiting */
  reason?: string;
}

// ============================================================================
// Rate Limit State Storage
// ============================================================================

/**
 * In-memory storage for rate limit state per tool
 */
const rateLimitState = new Map<string, RateLimitState>();

/**
 * In-memory storage for rate limit state per endpoint.
 *
 * Complements the per-tool limiter above. Per-tool is the right layer for
 * "user is invoking scan_market too fast"; per-endpoint is the right layer
 * for "the underlying Binance /api/v3/klines endpoint has a 1200 weight/min
 * limit regardless of which tool called it." Keyed by `exchange:endpoint`
 * (e.g. "binance:klines", "coinbase:orders", "finnhub:calendar/earnings").
 *
 * Intentionally additive — existing tool-level limits keep working; the
 * endpoint layer can be enforced by venue clients or HTTP interceptors.
 */
const endpointRateLimitState = new Map<string, RateLimitState>();

/**
 * Per-endpoint rate limit configuration. Mirrors ToolRateLimitConfig shape
 * but keyed by a composite endpoint string so one config entry covers every
 * tool that uses that endpoint.
 */
export interface EndpointRateLimitConfig {
  cooldownMs: number;
  maxCallsPerWindow: number;
  windowMs: number;
  /** Optional human-readable message when the limit is hit. */
  rateLimitMessage?: string;
}

export const ENDPOINT_RATE_LIMITS: Record<string, EndpointRateLimitConfig> = {
  // Finnhub free tier: 60 req/min across all endpoints
  "finnhub:*": {
    cooldownMs: 100,
    maxCallsPerWindow: 55,
    windowMs: 60_000,
    rateLimitMessage: "Finnhub rate limit (60 req/min on free tier).",
  },
  // Binance public klines: per-endpoint weight limit
  "binance:klines": {
    cooldownMs: 50,
    maxCallsPerWindow: 100,
    windowMs: 60_000,
    rateLimitMessage: "Binance klines weight limit exceeded.",
  },
  // Hyperliquid public info: self-imposed conservative limit
  "hyperliquid:info": {
    cooldownMs: 100,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
    rateLimitMessage: "Hyperliquid public info rate limit.",
  },
  // CDP platform API: conservative shared bucket
  "cdp:*": {
    cooldownMs: 100,
    maxCallsPerWindow: 50,
    windowMs: 60_000,
    rateLimitMessage: "CDP API rate limit.",
  },
};

/**
 * Check whether a call to a specific endpoint is allowed. Returns the same
 * shape as `checkRateLimit` for consistency. Uses the most specific config
 * key first (`exchange:endpoint`), then falls back to the wildcard
 * `exchange:*` entry.
 */
export function checkEndpointRateLimit(
  exchange: string,
  endpoint: string,
  configOverride?: EndpointRateLimitConfig,
): { allowed: boolean; waitTimeMs?: number; reason?: string } {
  const key = `${exchange}:${endpoint}`;
  const config = configOverride
    ?? ENDPOINT_RATE_LIMITS[key]
    ?? ENDPOINT_RATE_LIMITS[`${exchange}:*`];
  if (!config) return { allowed: true };

  const now = Date.now();
  const state = endpointRateLimitState.get(key) ?? {
    lastCallTime: 0,
    callsInWindow: [],
  } as RateLimitState;

  if (state.lastCallTime > 0 && now - state.lastCallTime < config.cooldownMs) {
    const waitTimeMs = config.cooldownMs - (now - state.lastCallTime);
    return { allowed: false, waitTimeMs, reason: config.rateLimitMessage ?? "endpoint cooldown" };
  }

  const cutoff = now - config.windowMs;
  const recent = state.callsInWindow.filter((t) => t >= cutoff);
  if (recent.length >= config.maxCallsPerWindow) {
    const oldest = recent[0] ?? now;
    const waitTimeMs = config.windowMs - (now - oldest);
    return { allowed: false, waitTimeMs, reason: config.rateLimitMessage ?? "endpoint window full" };
  }

  return { allowed: true };
}

/**
 * Record a successful call to an endpoint. Callers should invoke this after
 * a successful request so the rate-limit state stays accurate.
 */
export function recordEndpointCall(exchange: string, endpoint: string): void {
  const key = `${exchange}:${endpoint}`;
  const now = Date.now();
  const state = endpointRateLimitState.get(key) ?? {
    lastCallTime: 0,
    callsInWindow: [],
  } as RateLimitState;
  state.lastCallTime = now;
  state.callsInWindow.push(now);
  const wildcardKey = `${exchange}:*`;
  const config = ENDPOINT_RATE_LIMITS[key] ?? ENDPOINT_RATE_LIMITS[wildcardKey];
  if (config) {
    const cutoff = now - config.windowMs;
    state.callsInWindow = state.callsInWindow.filter((t) => t >= cutoff);
  }
  endpointRateLimitState.set(key, state);
}

/** Reset per-endpoint rate limit state (for tests). */
export function resetEndpointRateLimitState(): void {
  endpointRateLimitState.clear();
}

// ============================================================================
// Per-Tool Rate Limit Configuration
// ============================================================================

/**
 * Pre-configured rate limits by tool ID
 *
 * Guidelines:
 * - Scanning tools: Longer cooldown (10-30s) to avoid API exhaustion
 * - History tools: Medium cooldown (5-10s) to avoid excessive queries
 * - Analysis tools: Short cooldown (2-5s) for responsive UX
 * - Trading tools: Very short cooldown (1s) for execution speed
 * - Info tools: Minimal cooldown (1s) for quick lookups
 */
export const TOOL_RATE_LIMITS: Record<string, ToolRateLimitConfig> = {
  // Market scanning tools - longer cooldowns
  scan_market: {
    cooldownMs: 15_000,
    maxCallsPerWindow: 4,
    windowMs: 60_000,
    rateLimitMessage: "Market scan is rate limited. Please wait before scanning again.",
  },
  scan_breakouts: {
    cooldownMs: 10_000,
    maxCallsPerWindow: 6,
    windowMs: 60_000,
    rateLimitMessage: "Breakout scan is rate limited. Please wait before scanning again.",
  },
  find_consolidating_coins: {
    cooldownMs: 10_000,
    maxCallsPerWindow: 6,
    windowMs: 60_000,
    rateLimitMessage: "Consolidation scan is rate limited. Please wait before scanning again.",
  },
  detect_whale_activity: {
    cooldownMs: 10_000,
    maxCallsPerWindow: 6,
    windowMs: 60_000,
    rateLimitMessage: "Whale detection is rate limited. Please wait before scanning again.",
  },
  scan_for_strategies: {
    cooldownMs: 20_000,
    maxCallsPerWindow: 3,
    windowMs: 60_000,
    rateLimitMessage: "Strategy scan is rate limited. Please wait before scanning again.",
  },

  // History tools - medium cooldowns
  get_trade_history: {
    cooldownMs: 5_000,
    maxCallsPerWindow: 12,
    windowMs: 60_000,
    rateLimitMessage: "Trade history is rate limited. Please wait a moment.",
  },
  get_transfer_history: {
    cooldownMs: 5_000,
    maxCallsPerWindow: 12,
    windowMs: 60_000,
    rateLimitMessage: "Transfer history is rate limited. Please wait a moment.",
  },
  get_historical_opportunities: {
    cooldownMs: 5_000,
    maxCallsPerWindow: 12,
    windowMs: 60_000,
    rateLimitMessage: "Historical opportunities query is rate limited. Please wait a moment.",
  },

  // Analysis tools - shorter cooldowns
  analyze_coin: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
    rateLimitMessage: "Coin analysis is rate limited. Please wait a moment.",
  },
  score_trading_opportunity: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
    rateLimitMessage: "Opportunity scoring is rate limited. Please wait a moment.",
  },

  // Technical indicator tools - short cooldowns
  get_rsi: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
  },
  get_macd: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
  },
  get_bollinger_bands: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
  },
  get_technical_analysis: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
  },
  get_support_resistance: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
  },
  get_volume_profile: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
  },

  // Backtest tools - longer cooldowns (resource intensive)
  run_backtest: {
    cooldownMs: 5_000,
    maxCallsPerWindow: 10,
    windowMs: 60_000,
    rateLimitMessage: "Backtest is rate limited. Please wait before running another.",
  },
  optimize_strategy: {
    cooldownMs: 10_000,
    maxCallsPerWindow: 5,
    windowMs: 60_000,
    rateLimitMessage: "Strategy optimization is rate limited. Please wait before running another.",
  },
  compare_backtests: {
    cooldownMs: 5_000,
    maxCallsPerWindow: 10,
    windowMs: 60_000,
    rateLimitMessage: "Backtest comparison is rate limited. Please wait before running another.",
  },

  // Trading tools - minimal cooldowns for execution
  create_plan: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
  },
  execute_plan: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 10,
    windowMs: 60_000,
    rateLimitMessage: "Plan execution is rate limited to prevent rapid order placement.",
  },
  close_trade: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 10,
    windowMs: 60_000,
  },

  // Account tools - minimal cooldowns
  get_account_balance: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
  },

  // Order book tools - short cooldowns
  get_order_book: {
    cooldownMs: 2_000,
    maxCallsPerWindow: 30,
    windowMs: 60_000,
  },
  analyze_order_book: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
  },

  // Chart tools
  show_price_chart: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
  },

  // Strategy tools
  detect_strategy: {
    cooldownMs: 3_000,
    maxCallsPerWindow: 20,
    windowMs: 60_000,
  },
  suggest_strategies: {
    cooldownMs: 5_000,
    maxCallsPerWindow: 12,
    windowMs: 60_000,
  },
};

// ============================================================================
// Rate Limit Functions
// ============================================================================

/**
 * Check if a tool call is allowed under rate limits
 *
 * @param toolName - Name of the tool
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export function checkRateLimit(
  toolName: string,
  config: ToolRateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const state = rateLimitState.get(toolName) ?? {
    lastCallTime: 0,
    callsInWindow: [],
  };

  // Check cooldown period
  const timeSinceLastCall = now - state.lastCallTime;
  if (timeSinceLastCall < config.cooldownMs) {
    const waitTime = config.cooldownMs - timeSinceLastCall;
    return {
      allowed: false,
      waitTimeMs: waitTime,
      reason: `Cooldown period active. Wait ${formatWaitTime(waitTime)}.`,
    };
  }

  // Check burst limiting (if configured)
  if (config.maxCallsPerWindow && config.windowMs) {
    // Remove old calls outside the window
    const windowStart = now - config.windowMs;
    const recentCalls = state.callsInWindow.filter((t) => t > windowStart);

    if (recentCalls.length >= config.maxCallsPerWindow) {
      // Find when the oldest call in window will expire
      const oldestCall = Math.min(...recentCalls);
      const waitTime = oldestCall + config.windowMs - now;
      return {
        allowed: false,
        waitTimeMs: Math.max(waitTime, config.cooldownMs),
        reason: `Rate limit reached (${config.maxCallsPerWindow} calls per ${config.windowMs / 1000}s). Wait ${formatWaitTime(waitTime)}.`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Record a tool call (update rate limit state)
 *
 * @param toolName - Name of the tool
 */
export function recordToolCall(toolName: string): void {
  const now = Date.now();
  const state = rateLimitState.get(toolName) ?? {
    lastCallTime: 0,
    callsInWindow: [],
  };

  // Get config to know window size
  const config = TOOL_RATE_LIMITS[toolName];
  const windowMs = config?.windowMs ?? 60_000;
  const windowStart = now - windowMs;

  // Update state
  const updatedState: RateLimitState = {
    lastCallTime: now,
    callsInWindow: [...state.callsInWindow.filter((t) => t > windowStart), now],
  };

  rateLimitState.set(toolName, updatedState);
}

/**
 * Format wait time for user display
 *
 * @param ms - Wait time in milliseconds
 * @returns Human-readable wait time
 */
export function formatWaitTime(ms: number): string {
  if (ms < 1000) {
    return "less than a second";
  }
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
}

// ============================================================================
// Wrapper Functions
// ============================================================================

/**
 * Wrap a tool executor with rate limiting
 *
 * If the tool is rate limited, returns an error object with wait time.
 *
 * @param toolName - Name of the tool (for config lookup)
 * @param executor - The original tool executor
 * @param config - Optional rate limit configuration (overrides TOOL_RATE_LIMITS)
 * @returns Wrapped executor with rate limiting
 *
 * @example
 * ```typescript
 * const rateLimitedExecutor = withRateLimit(
 *   "scan_market",
 *   originalExecutor,
 *   { cooldownMs: 10000 }
 * );
 * ```
 */
export function withRateLimit<TInput, TOutput>(
  toolName: string,
  executor: ToolExecutor<TInput, TOutput>,
  config?: Partial<ToolRateLimitConfig>
): ToolExecutor<TInput, TOutput | { error: string; rateLimited: true; waitTimeMs: number }> {
  // Merge configurations: provided config > tool-specific > defaults
  const toolConfig = TOOL_RATE_LIMITS[toolName];
  const finalConfig: ToolRateLimitConfig = {
    cooldownMs: config?.cooldownMs ?? toolConfig?.cooldownMs ?? 1000,
    maxCallsPerWindow: config?.maxCallsPerWindow ?? toolConfig?.maxCallsPerWindow,
    windowMs: config?.windowMs ?? toolConfig?.windowMs,
    rateLimitMessage:
      config?.rateLimitMessage ??
      toolConfig?.rateLimitMessage ??
      `${toolName} is rate limited. Please wait before trying again.`,
  };

  return async function rateLimitedExecutor(
    input: TInput,
    context?: MastraExecutionContext
  ): Promise<TOutput | { error: string; rateLimited: true; waitTimeMs: number }> {
    // Check rate limit
    const result = checkRateLimit(toolName, finalConfig);

    if (!result.allowed) {
      return {
        error: `${finalConfig.rateLimitMessage} ${result.reason ?? ""}`.trim(),
        rateLimited: true as const,
        waitTimeMs: result.waitTimeMs ?? finalConfig.cooldownMs,
      };
    }

    // Record the call
    recordToolCall(toolName);

    // Execute the tool
    return executor(input, context);
  };
}

/**
 * Get rate limit configuration for a tool
 *
 * @param toolId - Tool identifier
 * @returns Rate limit config or default if none configured
 */
export function getToolRateLimitConfig(toolId: string): ToolRateLimitConfig {
  return (
    TOOL_RATE_LIMITS[toolId] ?? {
      cooldownMs: 1000,
      rateLimitMessage: `${toolId} is rate limited. Please wait before trying again.`,
    }
  );
}

/**
 * Check if a result indicates rate limiting
 *
 * @param result - Tool result
 * @returns Whether the result indicates rate limiting
 */
export function isRateLimitedResult(
  result: unknown
): result is { error: string; rateLimited: true; waitTimeMs: number } {
  return (
    result !== null &&
    typeof result === "object" &&
    "rateLimited" in result &&
    (result as { rateLimited: unknown }).rateLimited === true
  );
}

/**
 * Get current rate limit state for a tool
 *
 * @param toolName - Name of the tool
 * @returns Current rate limit state or null if none
 */
export function getToolRateLimitState(toolName: string): {
  lastCallTime: number;
  callsInLastMinute: number;
  cooldownRemaining: number;
} | null {
  const state = rateLimitState.get(toolName);
  if (!state) {
    return null;
  }

  const config = getToolRateLimitConfig(toolName);
  const now = Date.now();
  const windowMs = config.windowMs ?? 60_000;
  const windowStart = now - windowMs;

  return {
    lastCallTime: state.lastCallTime,
    callsInLastMinute: state.callsInWindow.filter((t) => t > windowStart).length,
    cooldownRemaining: Math.max(0, config.cooldownMs - (now - state.lastCallTime)),
  };
}

/**
 * Reset rate limit state for a tool
 *
 * @param toolName - Name of the tool (or undefined to reset all)
 */
export function resetRateLimitState(toolName?: string): void {
  if (toolName) {
    rateLimitState.delete(toolName);
  } else {
    rateLimitState.clear();
  }
}

/**
 * Get rate limit stats for all tools
 *
 * @returns Map of tool names to their current rate limit state
 */
export function getAllRateLimitStats(): Map<
  string,
  { lastCallTime: number; callsInLastMinute: number; cooldownRemaining: number }
> {
  const stats = new Map<
    string,
    { lastCallTime: number; callsInLastMinute: number; cooldownRemaining: number }
  >();
  const now = Date.now();

  for (const [toolName, state] of rateLimitState.entries()) {
    const config = getToolRateLimitConfig(toolName);
    const windowMs = config.windowMs ?? 60_000;
    const windowStart = now - windowMs;

    stats.set(toolName, {
      lastCallTime: state.lastCallTime,
      callsInLastMinute: state.callsInWindow.filter((t) => t > windowStart).length,
      cooldownRemaining: Math.max(0, config.cooldownMs - (now - state.lastCallTime)),
    });
  }

  return stats;
}
