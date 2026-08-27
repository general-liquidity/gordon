/**
 * MCP Server Resilience — Auto-Reconnect + Failure Mitigation
 *
 * Two high-priority gaps from Claude Code's MCP implementation:
 *
 * 1. Auto-reconnect: detect server crashes/session expiry, reconnect
 *    with exponential backoff, resume tool discovery
 *
 * 2. Failure mitigation: cache known-failing servers (skip for 15min),
 *    configurable per-request timeouts, retry with backoff
 *
 * Integration: wraps the MCPClient connection lifecycle. Called from
 * client.ts instead of raw MCPClient operations.
 */

import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("mcp-resilience");

// ============================================================================
// Types
// ============================================================================

export interface ResilienceConfig {
  /** Max reconnection attempts before giving up. Default 5. */
  maxReconnectAttempts: number;
  /** Initial backoff delay in ms. Default 2000. */
  initialBackoffMs: number;
  /** Max backoff delay in ms. Default 60000. */
  maxBackoffMs: number;
  /** Backoff multiplier. Default 2. */
  backoffMultiplier: number;
  /** How long to cache a failure (skip server). Default 900000 (15min). */
  failureCacheDurationMs: number;
  /** Per-request timeout. Default 30000. Overridable via MCP_TOOL_TIMEOUT env. */
  requestTimeoutMs: number;
  /** Max consecutive failures before caching as "known-failing". Default 3. */
  failureThreshold: number;
}

export const DEFAULT_RESILIENCE_CONFIG: ResilienceConfig = {
  maxReconnectAttempts: 5,
  initialBackoffMs: 2000,
  maxBackoffMs: 60_000,
  backoffMultiplier: 2,
  failureCacheDurationMs: 15 * 60 * 1000, // 15 minutes
  requestTimeoutMs: parseInt(process.env.MCP_TOOL_TIMEOUT ?? "30000", 10),
  failureThreshold: 3,
};

// ============================================================================
// Failure Cache (skip known-failing servers)
// ============================================================================

interface FailureEntry {
  serverId: string;
  consecutiveFailures: number;
  lastFailureAt: number;
  lastError: string;
  /** If true, skip this server until cache expires. */
  cached: boolean;
  cachedUntil: number;
}

const failureCache = new Map<string, FailureEntry>();

/**
 * Check if a server is known-failing and should be skipped.
 */
export function isServerCachedAsFailing(serverId: string): boolean {
  const entry = failureCache.get(serverId);
  if (!entry?.cached) return false;
  if (Date.now() > entry.cachedUntil) {
    // Cache expired — give it another chance
    failureCache.delete(serverId);
    return false;
  }
  return true;
}

/**
 * Record a server failure. After threshold consecutive failures,
 * cache the server as "known-failing" for failureCacheDurationMs.
 */
export function recordServerFailure(
  serverId: string,
  error: string,
  config: ResilienceConfig = DEFAULT_RESILIENCE_CONFIG,
): FailureEntry {
  const existing = failureCache.get(serverId);
  const entry: FailureEntry = {
    serverId,
    consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
    lastFailureAt: Date.now(),
    lastError: error,
    cached: false,
    cachedUntil: 0,
  };

  if (entry.consecutiveFailures >= config.failureThreshold) {
    entry.cached = true;
    entry.cachedUntil = Date.now() + config.failureCacheDurationMs;
    logger.warn(
      `Server ${serverId} cached as failing for ${config.failureCacheDurationMs / 60000}min after ${entry.consecutiveFailures} failures`,
      {
        serverId,
        lastError: error,
        cachedUntil: new Date(entry.cachedUntil).toISOString(),
      },
    );
  }

  failureCache.set(serverId, entry);
  return entry;
}

/**
 * Record a server success. Resets the failure counter.
 */
export function recordServerSuccess(serverId: string): void {
  failureCache.delete(serverId);
}

/**
 * Get failure status for all servers (for diagnostics).
 */
export function getFailureStatus(): Array<{
  serverId: string;
  failures: number;
  cached: boolean;
  cachedUntil?: string;
  lastError: string;
}> {
  return [...failureCache.values()].map((e) => ({
    serverId: e.serverId,
    failures: e.consecutiveFailures,
    cached: e.cached,
    cachedUntil: e.cached ? new Date(e.cachedUntil).toISOString() : undefined,
    lastError: e.lastError,
  }));
}

/**
 * Clear failure cache for a server (manual retry).
 */
export function clearServerFailure(serverId: string): void {
  failureCache.delete(serverId);
}

/**
 * Clear all failure caches.
 */
export function clearAllFailures(): void {
  failureCache.clear();
}

// ============================================================================
// Auto-Reconnect
// ============================================================================

export interface ReconnectState {
  serverId: string;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number;
  status: "reconnecting" | "connected" | "exhausted" | "cached_failure";
}

const reconnectStates = new Map<string, ReconnectState>();

/**
 * Compute backoff delay for a reconnection attempt.
 */
export function computeBackoff(
  attempt: number,
  config: ResilienceConfig = DEFAULT_RESILIENCE_CONFIG,
): number {
  const delay = config.initialBackoffMs * config.backoffMultiplier ** attempt;
  // Add jitter (±20%)
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.min(config.maxBackoffMs, delay + jitter);
}

/**
 * Attempt to reconnect a failed server with exponential backoff.
 * Returns true if reconnection should be attempted, false if exhausted.
 */
export function shouldAttemptReconnect(
  serverId: string,
  config: ResilienceConfig = DEFAULT_RESILIENCE_CONFIG,
): { shouldRetry: boolean; delayMs: number; attempt: number } {
  // Check failure cache first
  if (isServerCachedAsFailing(serverId)) {
    return { shouldRetry: false, delayMs: 0, attempt: 0 };
  }

  const state = reconnectStates.get(serverId);

  if (!state) {
    // First reconnect attempt
    const newState: ReconnectState = {
      serverId,
      attempt: 0,
      maxAttempts: config.maxReconnectAttempts,
      nextRetryAt: Date.now(),
      status: "reconnecting",
    };
    reconnectStates.set(serverId, newState);
    return { shouldRetry: true, delayMs: 0, attempt: 0 };
  }

  if (state.attempt >= state.maxAttempts) {
    state.status = "exhausted";
    logger.error(`Server ${serverId} reconnection exhausted after ${state.attempt} attempts`);
    // Cache as failing to prevent further attempts
    recordServerFailure(serverId, "Reconnection exhausted", config);
    return { shouldRetry: false, delayMs: 0, attempt: state.attempt };
  }

  state.attempt++;
  const delay = computeBackoff(state.attempt, config);
  state.nextRetryAt = Date.now() + delay;

  logger.info(
    `Server ${serverId} reconnecting (attempt ${state.attempt}/${state.maxAttempts}, delay ${Math.round(delay)}ms)`,
  );

  return { shouldRetry: true, delayMs: delay, attempt: state.attempt };
}

/**
 * Mark a server as successfully reconnected.
 */
export function markReconnected(serverId: string): void {
  reconnectStates.delete(serverId);
  recordServerSuccess(serverId);
  logger.info(`Server ${serverId} reconnected successfully`);
}

/**
 * Sleep helper for backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry and backoff.
 * Used for wrapping MCP operations (tool calls, discovery).
 */
export async function withRetry<T>(
  serverId: string,
  operation: () => Promise<T>,
  config: ResilienceConfig = DEFAULT_RESILIENCE_CONFIG,
): Promise<T> {
  // Skip if known-failing
  if (isServerCachedAsFailing(serverId)) {
    const entry = failureCache.get(serverId)!;
    throw new Error(
      `Server ${serverId} is cached as failing until ${new Date(entry.cachedUntil).toISOString()}: ${entry.lastError}`,
    );
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxReconnectAttempts; attempt++) {
    try {
      const result = await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${config.requestTimeoutMs}ms`)),
            config.requestTimeoutMs,
          ),
        ),
      ]);

      // Success — reset failure state
      recordServerSuccess(serverId);
      if (attempt > 0) markReconnected(serverId);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        `Server ${serverId} operation failed (attempt ${attempt + 1}/${config.maxReconnectAttempts + 1})`,
        {
          error: lastError.message,
        },
      );

      recordServerFailure(serverId, lastError.message, config);

      // Check if we should retry
      if (attempt < config.maxReconnectAttempts) {
        const delay = computeBackoff(attempt, config);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error(`Server ${serverId} operation failed after all retries`);
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Get full resilience diagnostics for /doctor display.
 */
export function getResilienceDiagnostics(): {
  failingServers: ReturnType<typeof getFailureStatus>;
  reconnecting: Array<{ serverId: string; attempt: number; status: string }>;
  config: ResilienceConfig;
} {
  return {
    failingServers: getFailureStatus(),
    reconnecting: [...reconnectStates.values()].map((s) => ({
      serverId: s.serverId,
      attempt: s.attempt,
      status: s.status,
    })),
    config: DEFAULT_RESILIENCE_CONFIG,
  };
}
