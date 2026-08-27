/**
 * Error Recovery & Fallback Logic
 *
 * Extracted from orchestrator.ts — handles transient error detection,
 * exponential backoff, and the default agent fallback chain configuration.
 */

import { createModuleLogger } from "../../logger/index.ts";
import type { AgentFallbackChain } from "./types.ts";

const logger = createModuleLogger("orchestrator-error");

// ============================================================================
// Transient Error Detection
// ============================================================================

/**
 * Check if an error is transient and should be retried
 */
export function isTransientError(error: Error): boolean {
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
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number): number {
  // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs * 0.5;
  return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
}

// ============================================================================
// Default Fallback Chain
// ============================================================================

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
    fallbacks: [{ name: "backtest_cache", type: "cache" }],
    maxRetries: 2,
    baseDelayMs: 2000,
    useCacheOnFailure: true,
  },
  Scanner: {
    primaryAgent: "Scanner",
    fallbacks: [{ name: "scan_market", type: "tool" }],
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
    fallbacks: [{ name: "check_positions", type: "tool" }],
    maxRetries: 3,
    baseDelayMs: 1000,
    useCacheOnFailure: true,
  },
};

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
  days: number,
): string {
  return `backtest:${symbol}:${strategyId}:${timeframe}:${days}`;
}
