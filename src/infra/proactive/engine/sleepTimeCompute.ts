/**
 * Sleep-time compute — idle pre-computation cache.
 *
 * From the Hitchhiker's Guide to Agentic AI (p340, §17.11.3): during idle
 * periods, anticipate likely-next queries and pre-compute + cache the
 * reasoning/summaries. When the operator's next query matches a pre-computed
 * analysis, it returns instantly from cache instead of paying the full
 * test-time latency + token cost. On predictable workloads this cuts perceived
 * latency substantially.
 *
 * Gordon's proactive radar already fires on an idle tick loop
 * (`observer.ts`). This module hooks that loop: on a low-activity tick, it
 * runs a small, bounded set of likely-next analyses (current regime, portfolio
 * drawdown, top-holding correlation) and caches them with a TTL. A follow-up
 * query like "what's my risk on ETH?" then hits the fresh cache.
 *
 * Discipline (matches Gordon's cost/hot-tier conventions):
 *   - OPT-IN via GORDON_SLEEP_TIME=1 — it spends tokens on idle, so off by default.
 *   - BOUNDED — a hard cap on the number of analyses precomputed per pass.
 *   - TTL'd — stale entries are treated as a miss and recomputed on the next pass.
 *   - IDLE-GATED — only runs when there has been no recent operator activity.
 *
 * The analysis producers are dependency-injected (a registry the runtime fills
 * when it has a live context), so the core is fake-testable and context-free.
 */

import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("sleep-time-compute");

// ============================================================================
// Config
// ============================================================================

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 min — freshness window for cached analyses
const DEFAULT_IDLE_THRESHOLD_MS = 3 * 60 * 1000; // 3 min of no activity == idle
const DEFAULT_MAX_ANALYSES = 6; // bounded cost per precompute pass

export function isSleepTimeEnabled(): boolean {
  return process.env.GORDON_SLEEP_TIME === "1";
}

function resolveTtlMs(): number {
  const raw = Number(process.env.GORDON_SLEEP_TIME_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

// ============================================================================
// Types
// ============================================================================

/** A precomputable analysis: an id, keywords that route a query to it, and a compute fn. */
export interface SleepAnalysis {
  /** Stable key, e.g. "regime", "drawdown", "eth_correlation". */
  key: string;
  /** Human-readable label for the cached result. */
  label: string;
  /** Lower-cased keywords; a query containing any of these routes to this entry. */
  keywords: string[];
  /** Produces the analysis text. Should be cheap + read-only. */
  compute: () => Promise<string>;
}

export interface SleepCacheEntry {
  key: string;
  label: string;
  keywords: string[];
  value: string;
  computedAt: number;
}

export interface PrecomputeResult {
  ran: boolean;
  reason: string;
  computed: number;
  failed: number;
  keys: string[];
}

// ============================================================================
// Cache
// ============================================================================

export class SleepTimeCache {
  private entries = new Map<string, SleepCacheEntry>();

  constructor(private ttlMs: number = DEFAULT_TTL_MS) {}

  put(entry: SleepCacheEntry): void {
    this.entries.set(entry.key, entry);
  }

  isFresh(entry: SleepCacheEntry, now: number): boolean {
    return now - entry.computedAt < this.ttlMs;
  }

  /** Get a fresh entry by key, or null if absent/stale. */
  get(key: string, now: number = Date.now()): SleepCacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return this.isFresh(entry, now) ? entry : null;
  }

  /**
   * Match a natural-language query to a fresh cached entry by keyword overlap.
   * Returns the best (most keyword hits) fresh entry, or null on miss/stale.
   */
  match(query: string, now: number = Date.now()): SleepCacheEntry | null {
    const q = query.toLowerCase();
    let best: SleepCacheEntry | null = null;
    let bestHits = 0;
    for (const entry of this.entries.values()) {
      if (!this.isFresh(entry, now)) continue;
      const hits = entry.keywords.reduce((n, kw) => (kw && q.includes(kw) ? n + 1 : n), 0);
      if (hits > bestHits) {
        bestHits = hits;
        best = entry;
      }
    }
    return bestHits > 0 ? best : null;
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

// ============================================================================
// Module singletons — the runtime-facing surface
// ============================================================================

let singletonCache: SleepTimeCache | null = null;
let registeredAnalyses: SleepAnalysis[] = [];
let lastActivityAt = 0;

export function getSleepTimeCache(): SleepTimeCache {
  if (!singletonCache) singletonCache = new SleepTimeCache(resolveTtlMs());
  return singletonCache;
}

/**
 * Register the analysis producers the idle pass should precompute. The runtime
 * calls this when it has a live context (llm/exchange/portfolio). Replaces any
 * previously registered set. Bounded to DEFAULT_MAX_ANALYSES.
 */
export function registerSleepAnalyses(analyses: SleepAnalysis[]): void {
  registeredAnalyses = analyses.slice(0, DEFAULT_MAX_ANALYSES);
}

export function clearSleepAnalyses(): void {
  registeredAnalyses = [];
}

export function getRegisteredSleepAnalyses(): SleepAnalysis[] {
  return registeredAnalyses;
}

/** Record operator activity — resets the idle clock so precompute waits again. */
export function recordSleepTimeActivity(now: number = Date.now()): void {
  lastActivityAt = now;
}

export function isIdle(now: number = Date.now(), idleThresholdMs = DEFAULT_IDLE_THRESHOLD_MS): boolean {
  return now - lastActivityAt >= idleThresholdMs;
}

// ============================================================================
// Precompute + lookup
// ============================================================================

/**
 * Run the supplied (or registered) analyses and populate the cache. Pure and
 * fake-testable: pass `analyses` + `cache` + `now` explicitly in tests.
 *
 * Each analysis runs independently; a failure in one does not abort the pass.
 * Bounded by `maxAnalyses`.
 */
export async function runSleepTimePrecompute(options: {
  analyses?: SleepAnalysis[];
  cache?: SleepTimeCache;
  now?: number;
  maxAnalyses?: number;
} = {}): Promise<PrecomputeResult> {
  const analyses = (options.analyses ?? registeredAnalyses).slice(
    0,
    options.maxAnalyses ?? DEFAULT_MAX_ANALYSES,
  );
  const cache = options.cache ?? getSleepTimeCache();
  const now = options.now ?? Date.now();

  if (analyses.length === 0) {
    return { ran: false, reason: "no analyses registered", computed: 0, failed: 0, keys: [] };
  }

  let computed = 0;
  let failed = 0;
  const keys: string[] = [];

  await Promise.all(
    analyses.map(async (analysis) => {
      try {
        const value = await analysis.compute();
        cache.put({
          key: analysis.key,
          label: analysis.label,
          keywords: analysis.keywords.map((k) => k.toLowerCase()),
          value,
          computedAt: now,
        });
        computed += 1;
        keys.push(analysis.key);
      } catch (err) {
        failed += 1;
        logger.debug("Sleep-time analysis failed", { key: analysis.key, err: String(err) });
      }
    }),
  );

  return { ran: true, reason: "precomputed", computed, failed, keys };
}

/**
 * Observer entry point: called from the idle tick loop. No-op unless the flag
 * is enabled, the session is idle, and analyses are registered. Then it runs a
 * bounded precompute pass over the registered analyses.
 */
export async function tickSleepTimePrecompute(options: {
  now?: number;
  idleThresholdMs?: number;
} = {}): Promise<PrecomputeResult> {
  const now = options.now ?? Date.now();
  if (!isSleepTimeEnabled()) {
    return { ran: false, reason: "GORDON_SLEEP_TIME not enabled", computed: 0, failed: 0, keys: [] };
  }
  if (registeredAnalyses.length === 0) {
    return { ran: false, reason: "no analyses registered", computed: 0, failed: 0, keys: [] };
  }
  if (!isIdle(now, options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS)) {
    return { ran: false, reason: "session not idle", computed: 0, failed: 0, keys: [] };
  }
  const result = await runSleepTimePrecompute({ now });
  if (result.computed > 0) {
    logger.info("Sleep-time precompute populated cache", {
      computed: result.computed,
      failed: result.failed,
      keys: result.keys,
    });
  }
  return result;
}

/**
 * Look up a fresh precomputed analysis for a query. Returns the cached entry on
 * a hit, or null when there is no fresh match (caller then computes live).
 */
export function lookupSleepTimeAnalysis(
  query: string,
  now: number = Date.now(),
  cache: SleepTimeCache = getSleepTimeCache(),
): SleepCacheEntry | null {
  return cache.match(query, now);
}

/** Test/lifecycle helper — reset all module state. */
export function resetSleepTimeState(): void {
  singletonCache?.clear();
  singletonCache = null;
  registeredAnalyses = [];
  lastActivityAt = 0;
}
