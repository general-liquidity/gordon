/**
 * Pre-Fetch Pipeline — Speculative Data Loading
 *
 * Trading equivalent of Claude Code's speculation/pipelining. While the
 * user reads analysis output, pre-fetch the data likely needed for the
 * next action:
 *
 *   - After analysis → pre-fetch orderbook + compute optimal entry
 *   - After plan creation → pre-fetch account balances + margin
 *   - After scan → pre-fetch candles for top hits
 *   - After execution → pre-fetch updated positions + P&L
 *
 * Speculative fetches are cached; if the user goes a different direction,
 * the cache expires naturally.
 */

// ============================================================================
// Types
// ============================================================================

export type PrefetchTrigger =
  | "post_analysis" // User just saw analysis → likely wants to trade
  | "post_plan" // Plan created → likely wants to execute
  | "post_scan" // Scan results shown → likely wants to drill into top hits
  | "post_execution" // Order placed → likely wants to check fills/positions
  | "post_login" // Just connected → likely wants portfolio overview
  | "symbol_mentioned" // Symbol referenced in chat → fetch context
  | "custom";

export interface PrefetchTask {
  id: string;
  trigger: PrefetchTrigger;
  /** What to fetch. */
  description: string;
  /** The actual fetch function. */
  fetch: () => Promise<unknown>;
  /** Cache key — if data with this key exists and isn't stale, skip. */
  cacheKey: string;
  /** How long the result stays valid. Default 30s. */
  ttlMs?: number;
  /** Priority (lower = fetch first). Default 10. */
  priority?: number;
}

interface CacheEntry {
  data: unknown;
  expiresAt: number;
  fetchedAt: number;
}

// ============================================================================
// Pipeline
// ============================================================================

export class PrefetchPipeline {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<unknown>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 30_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Schedule prefetch tasks. Runs in parallel (no blocking).
   * Deduplicates by cacheKey — if already in-flight or cached, skips.
   */
  prefetch(tasks: PrefetchTask[]): void {
    const sorted = [...tasks].sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10));

    for (const task of sorted) {
      // Skip if cached and fresh
      const cached = this.cache.get(task.cacheKey);
      if (cached && cached.expiresAt > Date.now()) continue;

      // Skip if already in-flight
      if (this.inflight.has(task.cacheKey)) continue;

      // Launch fetch (fire-and-forget)
      const promise = task
        .fetch()
        .then((data) => {
          this.cache.set(task.cacheKey, {
            data,
            expiresAt: Date.now() + (task.ttlMs ?? this.defaultTtlMs),
            fetchedAt: Date.now(),
          });
        })
        .catch(() => {
          // Prefetch failures are non-critical — silently discard
        })
        .finally(() => {
          this.inflight.delete(task.cacheKey);
        });

      this.inflight.set(task.cacheKey, promise);
    }
  }

  /**
   * Get cached data (if available and fresh). Returns null if miss.
   */
  get<T>(cacheKey: string): T | null {
    const entry = this.cache.get(cacheKey);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.data as T;
  }

  /**
   * Get cached data, or fetch it now (blocking).
   */
  async getOrFetch<T>(cacheKey: string, fetch: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get<T>(cacheKey);
    if (cached !== null) return cached;

    // Wait for in-flight if exists
    const inflight = this.inflight.get(cacheKey);
    if (inflight) {
      await inflight;
      const result = this.get<T>(cacheKey);
      if (result !== null) return result;
    }

    // Fetch now
    const data = await fetch();
    this.cache.set(cacheKey, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
      fetchedAt: Date.now(),
    });
    return data;
  }

  /**
   * Invalidate a cache entry (e.g., after a trade changes state).
   */
  invalidate(cacheKey: string): void {
    this.cache.delete(cacheKey);
  }

  /**
   * Invalidate all entries matching a prefix (e.g., all entries for a symbol).
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /**
   * Clear all caches.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Stats for debugging.
   */
  stats(): { cached: number; inflight: number; stale: number } {
    const now = Date.now();
    let stale = 0;
    for (const entry of this.cache.values()) {
      if (entry.expiresAt < now) stale++;
    }
    return { cached: this.cache.size, inflight: this.inflight.size, stale };
  }
}

// ── Singleton ──

let instance: PrefetchPipeline | null = null;

export function getPrefetchPipeline(): PrefetchPipeline {
  if (!instance) instance = new PrefetchPipeline();
  return instance;
}

export function resetPrefetchPipeline(): void {
  instance?.clear();
  instance = null;
}

// ============================================================================
// Pre-built Trigger Handlers
// ============================================================================

/**
 * Build prefetch tasks for a given trigger. Caller provides the actual
 * fetch functions since they depend on the active venue/broker.
 */
export function buildPrefetchTasks(
  trigger: PrefetchTrigger,
  context: { symbol?: string; symbols?: string[] },
  fetchers: {
    fetchOrderbook?: (symbol: string) => Promise<unknown>;
    fetchCandles?: (symbol: string) => Promise<unknown>;
    fetchBalance?: () => Promise<unknown>;
    fetchPositions?: () => Promise<unknown>;
    fetchOpenOrders?: () => Promise<unknown>;
  },
): PrefetchTask[] {
  const tasks: PrefetchTask[] = [];

  switch (trigger) {
    case "post_analysis":
      if (context.symbol && fetchers.fetchOrderbook) {
        tasks.push({
          id: "prefetch_orderbook",
          trigger,
          description: `Pre-fetch ${context.symbol} orderbook`,
          fetch: () => fetchers.fetchOrderbook!(context.symbol!),
          cacheKey: `orderbook:${context.symbol}`,
          priority: 1,
          ttlMs: 10_000,
        });
      }
      if (fetchers.fetchBalance) {
        tasks.push({
          id: "prefetch_balance",
          trigger,
          description: "Pre-fetch account balance",
          fetch: fetchers.fetchBalance,
          cacheKey: "balance",
          priority: 2,
        });
      }
      break;

    case "post_scan":
      for (const sym of (context.symbols ?? []).slice(0, 5)) {
        if (fetchers.fetchCandles) {
          tasks.push({
            id: `prefetch_candles_${sym}`,
            trigger,
            description: `Pre-fetch ${sym} candles`,
            fetch: () => fetchers.fetchCandles!(sym),
            cacheKey: `candles:${sym}`,
            priority: 5,
            ttlMs: 60_000,
          });
        }
      }
      break;

    case "post_execution":
    case "post_login":
      if (fetchers.fetchPositions) {
        tasks.push({
          id: "prefetch_positions",
          trigger,
          description: "Pre-fetch positions",
          fetch: fetchers.fetchPositions,
          cacheKey: "positions",
          priority: 1,
        });
      }
      if (fetchers.fetchOpenOrders) {
        tasks.push({
          id: "prefetch_orders",
          trigger,
          description: "Pre-fetch open orders",
          fetch: fetchers.fetchOpenOrders,
          cacheKey: "open_orders",
          priority: 2,
        });
      }
      if (fetchers.fetchBalance) {
        tasks.push({
          id: "prefetch_balance",
          trigger,
          description: "Pre-fetch balance",
          fetch: fetchers.fetchBalance,
          cacheKey: "balance",
          priority: 3,
        });
      }
      break;
  }

  return tasks;
}
