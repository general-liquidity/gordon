/**
 * KV-Cache Hit-Rate Metric (GORDON_KV_CACHE_METRIC).
 *
 * Port of the metric Manus calls "the single most important metric for a
 * production-stage AI agent" in "Context Engineering for AI Agents:
 * Lessons from Building Manus" (2026). The economic anchor:
 *
 *   "10x cost difference: cached tokens at $0.30/MTok vs uncached at
 *    $3/MTok with Claude Sonnet."
 *
 * Gordon already has `sharedPrefixCache.ts` (Anthropic prompt-cache
 * reuse) but no metric instrumenting it. This primitive captures
 * per-call (hit/miss, cached-token count, total-token count, prefix
 * hash) and computes rolling hit rate + cost-savings estimate.
 *
 * The primitive is data-only. Callers record one entry per LLM call;
 * readers can ask "what's our hit rate over the last N calls?" — a
 * concrete answer to "are we leaving the 10x lever on the table?"
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const KV_CACHE_METRIC_FLAG_ENV = "GORDON_KV_CACHE_METRIC";
export const KV_CACHE_METRIC_PATH_ENV = "GORDON_KV_CACHE_METRIC_PATH";

export interface CacheCallRecord {
  /** Stable id of the LLM call (trace id, span id, or counter). */
  callId: string;
  /** Hash of the cacheable prefix the call sent. */
  prefixHash: string;
  /** Whether the provider reported a cache hit. */
  hit: boolean;
  /** Tokens served from cache (provider-reported when available). */
  cachedTokens: number;
  /** Total input tokens this call sent. */
  totalInputTokens: number;
  /** ISO timestamp. */
  capturedAt: string;
  /** Optional model id for diagnostics. */
  modelId?: string;
}

export interface CacheHitRateSummary {
  windowSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  /** cachedTokens / totalInputTokens across the window — 0..1. */
  cacheTokenRatio: number;
  /**
   * Estimated cost saved (USD) assuming the Manus anchor: cached
   * tokens cost 1/10 of uncached. Lower bound — actual savings depend
   * on the model's specific pricing.
   */
  estimatedSavingsUsd: number;
}

export interface RecordCallInput {
  callId: string;
  prefixHash: string;
  hit: boolean;
  cachedTokens?: number;
  totalInputTokens: number;
  modelId?: string;
  now?: string;
}

export function isKvCacheMetricEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[KV_CACHE_METRIC_FLAG_ENV] === "1" || env[KV_CACHE_METRIC_FLAG_ENV] === "true";
}

export function defaultKvCacheMetricPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[KV_CACHE_METRIC_PATH_ENV] ?? join(homedir(), ".gordon", "kv-cache-metrics.jsonl");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function recordCacheCall(input: RecordCallInput, path?: string): CacheCallRecord {
  const record: CacheCallRecord = {
    callId: input.callId,
    prefixHash: input.prefixHash,
    hit: input.hit,
    cachedTokens: input.cachedTokens ?? 0,
    totalInputTokens: input.totalInputTokens,
    capturedAt: input.now ?? new Date().toISOString(),
    modelId: input.modelId,
  };
  const target = path ?? defaultKvCacheMetricPath();
  ensureParentDir(target);
  appendFileSync(target, JSON.stringify(record) + "\n", "utf8");
  return record;
}

export function readCacheCalls(
  opts: { limit?: number; sinceMs?: number } = {},
  path?: string,
): CacheCallRecord[] {
  const target = path ?? defaultKvCacheMetricPath();
  if (!existsSync(target)) return [];
  const lines = readFileSync(target, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const out: CacheCallRecord[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as CacheCallRecord;
      if (typeof parsed.callId === "string" && typeof parsed.hit === "boolean") {
        if (opts.sinceMs !== undefined) {
          const t = Date.parse(parsed.capturedAt);
          if (Number.isFinite(t) && t < opts.sinceMs) continue;
        }
        out.push(parsed);
      }
    } catch {
      // skip malformed
    }
  }
  out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/**
 * Compute hit-rate summary over the most recent `windowSize` calls.
 * Uses the Manus anchor (cached tokens cost ~1/10 of uncached) to
 * estimate dollars saved — `usdPerMillionUncached` defaults to 3
 * (Claude Sonnet's input price at time of writing).
 */
export function summarizeHitRate(
  calls: readonly CacheCallRecord[],
  opts: { usdPerMillionUncached?: number } = {},
): CacheHitRateSummary {
  const usdPer = opts.usdPerMillionUncached ?? 3;
  const hits = calls.filter((c) => c.hit).length;
  const misses = calls.length - hits;
  const totalCached = calls.reduce((s, c) => s + c.cachedTokens, 0);
  const totalInput = calls.reduce((s, c) => s + c.totalInputTokens, 0);
  // Savings: cached tokens cost 1/10 of uncached → saved 9/10 of the
  // uncached price for every cached token.
  const savedTokens = totalCached;
  const estimatedSavingsUsd = (savedTokens / 1_000_000) * usdPer * 0.9;
  return {
    windowSize: calls.length,
    hits,
    misses,
    hitRate: calls.length === 0 ? 0 : hits / calls.length,
    cacheTokenRatio: totalInput === 0 ? 0 : totalCached / totalInput,
    estimatedSavingsUsd,
  };
}

export function formatHitRateSummary(s: CacheHitRateSummary): string {
  const lines: string[] = [];
  lines.push(
    `KV-cache hit rate over last ${s.windowSize} calls: ${(s.hitRate * 100).toFixed(1)}% (${s.hits} hit, ${s.misses} miss)`,
  );
  lines.push(`  cached-token ratio: ${(s.cacheTokenRatio * 100).toFixed(1)}%`);
  lines.push(`  estimated savings: $${s.estimatedSavingsUsd.toFixed(2)}`);
  return lines.join("\n");
}

export function summaryToPayload(summary: CacheHitRateSummary): Record<string, unknown> {
  return {
    kind: "kv_cache.hit_rate_recorded",
    windowSize: summary.windowSize,
    hitRate: Number(summary.hitRate.toFixed(3)),
    cacheTokenRatio: Number(summary.cacheTokenRatio.toFixed(3)),
    estimatedSavingsUsd: Number(summary.estimatedSavingsUsd.toFixed(2)),
  };
}
