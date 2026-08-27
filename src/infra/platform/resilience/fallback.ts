/**
 * Resilience Patterns: Fallback, Retry, and Circuit Breaker
 * Provides error recovery and graceful degradation for API calls
 */

import { Cache } from "../cache/cache.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("resilience");

// ============================================================================
// Types
// ============================================================================

/**
 * Options for fallback behavior
 */
export interface FallbackOptions<T> {
  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  cacheTTL?: number;
  /** Maximum number of retries before using fallback (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (default: 1000) */
  retryDelay?: number;
  /** Static fallback value if all else fails */
  fallbackValue?: T;
  /** Circuit breaker failure threshold (default: 5) */
  circuitBreakerThreshold?: number;
  /** Circuit breaker reset timeout in milliseconds (default: 30000) */
  circuitBreakerTimeout?: number;
  /** Whether to use stale cache on error (default: true) */
  useStaleOnError?: boolean;
}

/**
 * Result of a resilient operation
 */
export interface ResilientResult<T> {
  data: T;
  source: "fresh" | "cache" | "stale" | "fallback";
  retries: number;
  circuitState: CircuitState;
}

/**
 * Circuit breaker state
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker statistics
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  totalCalls: number;
  totalFailures: number;
}

// ============================================================================
// Retry with Exponential Backoff
// ============================================================================

/**
 * Retry an async function with exponential backoff
 *
 * @param fn - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay between retries in milliseconds (default: 1000)
 * @returns The result of the function
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = baseDelay * 2 ** attempt;
        const jitter = Math.random() * 0.3 * delay;
        const totalDelay = delay + jitter;

        logger.debug("Retry attempt", {
          attempt: String(attempt + 1),
          maxRetries: String(maxRetries),
          delayMs: String(Math.round(totalDelay)),
        });

        await sleep(totalDelay);
      }
    }
  }

  throw lastError;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

/**
 * Circuit breaker implementation for preventing cascading failures
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failure threshold exceeded, requests fail fast
 * - HALF-OPEN: Testing if service recovered, limited requests allowed
 */
export class CircuitBreaker {
  private failures: number = 0;
  private successes: number = 0;
  private lastFailure: number = 0;
  private lastSuccess: number = 0;
  private state: CircuitState = "closed";
  private halfOpenAttempts: number = 0;

  private totalCalls: number = 0;
  private totalFailures: number = 0;

  constructor(
    private readonly threshold: number = 5,
    private readonly resetTimeout: number = 30000,
    private readonly halfOpenMaxAttempts: number = 3,
  ) {}

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.isOpen()) {
      if (this.shouldAttemptReset()) {
        this.state = "half-open";
        this.halfOpenAttempts = 0;
        logger.info("Circuit breaker entering half-open state");
      } else {
        throw new CircuitBreakerOpenError("Circuit breaker is open", this.getStats());
      }
    }

    if (this.state === "half-open") {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts > this.halfOpenMaxAttempts) {
        this.trip();
        throw new CircuitBreakerOpenError(
          "Circuit breaker tripped during half-open",
          this.getStats(),
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if circuit is open
   */
  isOpen(): boolean {
    return this.state === "open";
  }

  /**
   * Check if circuit is closed (healthy)
   */
  isClosed(): boolean {
    return this.state === "closed";
  }

  /**
   * Check if circuit is half-open (testing)
   */
  isHalfOpen(): boolean {
    return this.state === "half-open";
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.successes = 0;
    this.halfOpenAttempts = 0;
    logger.info("Circuit breaker manually reset");
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitState {
    if (this.state === "open" && this.shouldAttemptReset()) {
      return "half-open";
    }
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure || null,
      lastSuccess: this.lastSuccess || null,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  private onSuccess(): void {
    this.lastSuccess = Date.now();
    this.successes++;

    if (this.state === "half-open") {
      if (this.successes >= this.halfOpenMaxAttempts) {
        this.reset();
        logger.info("Circuit breaker closed after successful recovery");
      }
    } else {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  private onFailure(): void {
    this.lastFailure = Date.now();
    this.failures++;
    this.totalFailures++;
    this.successes = 0;

    if (this.state === "half-open") {
      this.trip();
    } else if (this.failures >= this.threshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = "open";
    logger.warn("Circuit breaker tripped", {
      failures: String(this.failures),
      threshold: String(this.threshold),
    });
  }

  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailure >= this.resetTimeout;
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public readonly stats: CircuitBreakerStats,
  ) {
    super(message);
    this.name = "CircuitBreakerOpenError";
  }
}

// ============================================================================
// Fallback Cache
// ============================================================================

/**
 * Cache that stores both fresh and stale data for fallback purposes
 */
class FallbackCache<T> {
  private freshCache: Cache<T>;
  private staleCache: Cache<T>;

  constructor(freshTTL: number = 60000, staleTTL: number = 300000) {
    this.freshCache = new Cache<T>({
      defaultTtl: freshTTL,
      maxEntries: 1000,
    });
    this.staleCache = new Cache<T>({
      defaultTtl: staleTTL,
      maxEntries: 1000,
    });
  }

  get(key: string): { value: T; fresh: boolean } | undefined {
    const fresh = this.freshCache.get(key);
    if (fresh !== undefined) {
      return { value: fresh, fresh: true };
    }

    const stale = this.staleCache.get(key);
    if (stale !== undefined) {
      return { value: stale, fresh: false };
    }

    return undefined;
  }

  set(key: string, value: T, freshTTL?: number): void {
    this.freshCache.set(key, value, freshTTL);
    this.staleCache.set(key, value);
  }

  delete(key: string): void {
    this.freshCache.delete(key);
    this.staleCache.delete(key);
  }

  clear(): void {
    this.freshCache.clear();
    this.staleCache.clear();
  }
}

// Global fallback cache instance
const globalFallbackCache = new FallbackCache<unknown>(60000, 300000);

// Global circuit breakers by key
const circuitBreakers = new Map<string, CircuitBreaker>();

function getCircuitBreaker(key: string, threshold: number, timeout: number): CircuitBreaker {
  const existingBreaker = circuitBreakers.get(key);
  if (existingBreaker) {
    return existingBreaker;
  }

  const breaker = new CircuitBreaker(threshold, timeout);
  circuitBreakers.set(key, breaker);
  return breaker;
}

// ============================================================================
// Main Fallback Wrapper
// ============================================================================

/**
 * Wrap an async function with comprehensive fallback support
 *
 * This provides:
 * - Retry with exponential backoff
 * - Circuit breaker protection
 * - Cache fallback (fresh and stale)
 * - Static fallback value
 *
 * @param fn - The async function to wrap
 * @param cacheKey - Key for caching results
 * @param options - Fallback configuration options
 * @returns The result with metadata about the source
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  cacheKey: string,
  options: FallbackOptions<T> = {},
): Promise<ResilientResult<T>> {
  const {
    cacheTTL = 60000,
    maxRetries = 3,
    retryDelay = 1000,
    fallbackValue,
    circuitBreakerThreshold = 5,
    circuitBreakerTimeout = 30000,
    useStaleOnError = true,
  } = options;

  const circuitBreaker = getCircuitBreaker(
    cacheKey,
    circuitBreakerThreshold,
    circuitBreakerTimeout,
  );

  // Check fresh cache first
  const cached = globalFallbackCache.get(cacheKey);
  if (cached?.fresh) {
    return {
      data: cached.value as T,
      source: "cache",
      retries: 0,
      circuitState: circuitBreaker.getState(),
    };
  }

  let retries = 0;

  // Try to fetch fresh data
  try {
    const data = await circuitBreaker.execute(async () => {
      return await withRetry(fn, maxRetries, retryDelay);
    });

    // Update cache on success
    globalFallbackCache.set(cacheKey, data, cacheTTL);

    return {
      data,
      source: "fresh",
      retries,
      circuitState: circuitBreaker.getState(),
    };
  } catch (error) {
    retries = maxRetries;

    logger.warn("Primary request failed, attempting fallback", {
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });

    // Try stale cache
    if (useStaleOnError && cached) {
      logger.info("Using stale cached data", { cacheKey });
      return {
        data: cached.value as T,
        source: "stale",
        retries,
        circuitState: circuitBreaker.getState(),
      };
    }

    // Use fallback value if provided
    if (fallbackValue !== undefined) {
      logger.info("Using fallback value", { cacheKey });
      return {
        data: fallbackValue,
        source: "fallback",
        retries,
        circuitState: circuitBreaker.getState(),
      };
    }

    // Re-throw if no fallback available
    throw error;
  }
}

/**
 * Simplified fallback that returns just the data (throws on failure with no fallback)
 */
export async function withFallbackSimple<T>(
  fn: () => Promise<T>,
  cacheKey: string,
  options: FallbackOptions<T> = {},
): Promise<T> {
  const result = await withFallback(fn, cacheKey, options);
  return result.data;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get global circuit breaker for a key
 */
export function getGlobalCircuitBreaker(key: string): CircuitBreaker | undefined {
  return circuitBreakers.get(key);
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset();
  }
  logger.info("All circuit breakers reset");
}

/**
 * Get statistics for all circuit breakers
 */
export function getAllCircuitBreakerStats(): Record<string, CircuitBreakerStats> {
  const stats: Record<string, CircuitBreakerStats> = {};
  for (const [key, breaker] of circuitBreakers) {
    stats[key] = breaker.getStats();
  }
  return stats;
}

/**
 * Clear the global fallback cache
 */
export function clearFallbackCache(): void {
  globalFallbackCache.clear();
  logger.info("Fallback cache cleared");
}
