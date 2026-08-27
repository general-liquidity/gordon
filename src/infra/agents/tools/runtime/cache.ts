/**
 * Tool-Level Caching and Request Deduplication
 *
 * Provides caching wrappers for agent tools to:
 * 1. Cache tool results with TTL to avoid duplicate API calls
 * 2. Deduplicate concurrent in-flight requests
 * 3. Combine both for optimal performance
 *
 * Usage:
 * - Wrap tool executors with withCache(), withDeduplication(), or withCacheAndDeduplication()
 * - Configure TTL based on data freshness requirements
 * - Use TOOL_CACHE_CONFIG presets for common categories
 * - Use createCachedTool() to wrap Mastra tools
 */

import { createTool, type Tool, type ToolExecutionContext } from "@mastra/core/tools";
import { createCache } from "../../../platform/cache/cache.ts";
import type { MastraExecutionContext } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration options for tool caching
 */
export interface ToolCacheOptions {
  /** Time-to-live in milliseconds */
  ttl: number;
  /** Custom key generator function */
  keyGenerator?: (input: unknown) => string;
}

/**
 * Tool executor function signature
 */
export type ToolExecutor<TInput, TOutput> = (
  input: TInput,
  context?: MastraExecutionContext,
) => Promise<TOutput>;

// ============================================================================
// Cache Instance
// ============================================================================

/**
 * Shared cache instance for all tool results
 * Configured with reasonable defaults for tool caching
 */
const toolCache = createCache<unknown>({
  defaultTtl: 60000, // 1 minute default
  maxEntries: 500,
  updateTtlOnAccess: false,
});

// ============================================================================
// Key Generation
// ============================================================================

/**
 * Generate a stable cache key from tool name and input
 * Handles object key ordering for consistent hashing
 */
function generateCacheKey(toolName: string, input: unknown): string {
  const inputKey = stableStringify(input);
  return `tool:${toolName}:${inputKey}`;
}

/**
 * Create a stable string representation of a value
 * Sorts object keys to ensure consistent ordering
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  // Sort object keys for consistent ordering
  const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = sortedKeys.map((key) => {
    const v = (value as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${stableStringify(v)}`;
  });

  return `{${pairs.join(",")}}`;
}

// ============================================================================
// Caching Wrapper
// ============================================================================

/**
 * Wrap a tool executor with TTL-based caching
 *
 * Cached results are returned immediately without executing the tool.
 * After TTL expires, the next call will execute and cache fresh results.
 *
 * @example
 * ```typescript
 * const cachedExecutor = withCache(
 *   "get_technical_analysis",
 *   originalExecutor,
 *   { ttl: 60000 }
 * );
 * ```
 */
export function withCache<TInput, TOutput>(
  toolName: string,
  executor: ToolExecutor<TInput, TOutput>,
  options: ToolCacheOptions,
): ToolExecutor<TInput, TOutput> {
  return async function cachedExecutor(
    input: TInput,
    context?: MastraExecutionContext,
  ): Promise<TOutput> {
    const key = options.keyGenerator
      ? `tool:${toolName}:${options.keyGenerator(input)}`
      : generateCacheKey(toolName, input);

    // Check cache first
    const cached = toolCache.get(key);
    if (cached !== undefined) {
      return cached as TOutput;
    }

    // Execute and cache result
    const result = await executor(input, context);
    toolCache.set(key, result, options.ttl);

    return result;
  };
}

// ============================================================================
// Request Deduplication
// ============================================================================

/**
 * Map of in-flight requests keyed by cache key
 * Prevents duplicate API calls for identical concurrent requests
 */
const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Wrap a tool executor with request deduplication
 *
 * If an identical request is already in flight, returns the existing promise
 * instead of making a duplicate API call. Once the request completes,
 * subsequent identical requests will create new requests.
 *
 * @example
 * ```typescript
 * const dedupedExecutor = withDeduplication(
 *   "get_technical_analysis",
 *   originalExecutor
 * );
 * ```
 */
export function withDeduplication<TInput, TOutput>(
  toolName: string,
  executor: ToolExecutor<TInput, TOutput>,
): ToolExecutor<TInput, TOutput> {
  return async function dedupedExecutor(
    input: TInput,
    context?: MastraExecutionContext,
  ): Promise<TOutput> {
    const key = generateCacheKey(toolName, input);

    // Return existing in-flight request if present
    const inFlight = inFlightRequests.get(key);
    if (inFlight) {
      return inFlight as Promise<TOutput>;
    }

    // Create and track new request
    const promise = executor(input, context).finally(() => {
      inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, promise);

    return promise;
  };
}

// ============================================================================
// Combined Caching + Deduplication
// ============================================================================

/**
 * Wrap a tool executor with both caching and request deduplication
 *
 * This is the recommended wrapper for most API-calling tools:
 * 1. First checks cache for existing valid result
 * 2. If not cached, checks for in-flight request
 * 3. If no in-flight request, executes and caches result
 *
 * This provides optimal performance by:
 * - Returning cached results instantly (cache hit)
 * - Sharing results across concurrent identical requests (deduplication)
 * - Caching fresh results for future requests (cache miss)
 *
 * @example
 * ```typescript
 * const optimizedExecutor = withCacheAndDeduplication(
 *   "get_technical_analysis",
 *   originalExecutor,
 *   { ttl: 60000 }
 * );
 * ```
 */
export function withCacheAndDeduplication<TInput, TOutput>(
  toolName: string,
  executor: ToolExecutor<TInput, TOutput>,
  options: ToolCacheOptions,
): ToolExecutor<TInput, TOutput> {
  return async function cachedDedupedExecutor(
    input: TInput,
    context?: MastraExecutionContext,
  ): Promise<TOutput> {
    const key = options.keyGenerator
      ? `tool:${toolName}:${options.keyGenerator(input)}`
      : generateCacheKey(toolName, input);

    // Check cache first
    const cached = toolCache.get(key);
    if (cached !== undefined) {
      return cached as TOutput;
    }

    // Check for in-flight request
    const inFlight = inFlightRequests.get(key);
    if (inFlight) {
      return inFlight as Promise<TOutput>;
    }

    // Create new request with caching
    const promise = executor(input, context)
      .then((result) => {
        toolCache.set(key, result, options.ttl);
        return result;
      })
      .finally(() => {
        inFlightRequests.delete(key);
      });

    inFlightRequests.set(key, promise);

    return promise;
  };
}

// ============================================================================
// Mastra Tool Caching
// ============================================================================

/**
 * Create a cached version of a Mastra Tool
 *
 * Wraps the tool's execute function with caching and request deduplication
 * while preserving all other tool properties (id, description, schemas, etc.)
 *
 * @example
 * ```typescript
 * const cachedTool = createCachedTool(
 *   getTechnicalAnalysisTool,
 *   TOOL_CACHE_CONFIG.indicators.ttl
 * );
 * ```
 */
export function createCachedTool<
  TSchemaIn,
  TSchemaOut,
  TSuspend,
  TResume,
  TContext extends ToolExecutionContext<TSuspend, TResume>,
  TId extends string,
>(
  tool: Tool<TSchemaIn, TSchemaOut, TSuspend, TResume, TContext, TId>,
  ttl: number,
): Tool<TSchemaIn, TSchemaOut, TSuspend, TResume, TContext, TId> {
  const originalExecute = tool.execute;

  if (!originalExecute) {
    return tool;
  }

  // Create cached execute function
  const cachedExecute = async (input: TSchemaIn, context?: TContext): Promise<TSchemaOut> => {
    const key = generateCacheKey(tool.id, input);

    // Check cache first
    const cached = toolCache.get(key);
    if (cached !== undefined) {
      return cached as TSchemaOut;
    }

    // Check for in-flight request
    const inFlight = inFlightRequests.get(key);
    if (inFlight) {
      return inFlight as Promise<TSchemaOut>;
    }

    // Create new request with caching
    const promise = originalExecute(input, context as TContext)
      .then((result) => {
        // Only cache successful results (not validation errors)
        if (result && typeof result === "object" && !("error" in result)) {
          toolCache.set(key, result, ttl);
        } else if (result && typeof result === "object" && "error" in result) {
          // Don't cache error results - they may be transient
        } else {
          toolCache.set(key, result, ttl);
        }
        return result as TSchemaOut;
      })
      .finally(() => {
        inFlightRequests.delete(key);
      });

    inFlightRequests.set(key, promise);

    return promise;
  };

  // Return new tool with cached execute
  return createTool({
    id: tool.id,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    execute: cachedExecute as (
      input: TSchemaIn,
      context: ToolExecutionContext<unknown, unknown, unknown>,
    ) => Promise<TSchemaOut>,
  }) as Tool<TSchemaIn, TSchemaOut, TSuspend, TResume, TContext, TId>;
}

// ============================================================================
// Pre-configured Cache Settings
// ============================================================================

/**
 * Pre-configured cache settings by tool category
 *
 * Use these with withCache() or withCacheAndDeduplication() for consistent
 * caching behavior across similar tools.
 *
 * Guidelines:
 * - price: Short TTL (10s) - prices change frequently
 * - indicators: Medium TTL (1m) - based on candle data
 * - analysis: Longer TTL (5m) - computationally expensive
 * - orderbook: Very short TTL (5s) - highly dynamic
 * - account: Medium TTL (30s) - balance changes with trades
 */
export const TOOL_CACHE_CONFIG = {
  /** Price data - refreshes quickly (10 seconds) */
  price: { ttl: 10000 },

  /** Technical indicators - based on candles (1 minute) */
  indicators: { ttl: 60000 },

  /** Deep analysis - expensive computation (5 minutes) */
  analysis: { ttl: 300000 },

  /** Order book data - highly dynamic (5 seconds) */
  orderbook: { ttl: 5000 },

  /** Account information - changes with trades (30 seconds) */
  account: { ttl: 30000 },

  /** Market scanning - comprehensive scan (2 minutes) */
  scanning: { ttl: 120000 },

  /** Historical data - rarely changes (10 minutes) */
  historical: { ttl: 600000 },
} as const;

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Get cache statistics for monitoring
 */
export function getToolCacheStats(): {
  entries: number;
  hits: number;
  misses: number;
  hitRate: number;
  inFlightRequests: number;
} {
  const stats = toolCache.getStats();
  return {
    ...stats,
    inFlightRequests: inFlightRequests.size,
  };
}

/**
 * Clear all cached tool results
 * Useful for testing or when data is known to be stale
 */
export function clearToolCache(): void {
  toolCache.clear();
  inFlightRequests.clear();
}

/**
 * Remove expired entries from the cache
 * Returns the number of entries pruned
 */
export function pruneToolCache(): number {
  return toolCache.prune();
}

/**
 * Invalidate cache entries matching a pattern
 * Useful for invalidating related entries after a mutation
 *
 * @example
 * ```typescript
 * // Invalidate all BTCUSDT entries after a trade
 * invalidateToolCache("BTCUSDT");
 * ```
 */
export function invalidateToolCache(pattern: string): number {
  const keys = toolCache.keys();
  let invalidated = 0;

  for (const key of keys) {
    if (key.includes(pattern)) {
      toolCache.delete(key);
      invalidated++;
    }
  }

  return invalidated;
}
