/**
 * Post-processing enhancement for Gordon's existing hybrid search.
 *
 * Gordon already runs BM25 FTS5 + cosine-embedding hybrid search
 * (src/core/memory/store.ts:searchHybrid). This module layers temporal
 * decay + MMR diversification on top of those results — a strict
 * post-processing step that does NOT replace the underlying search.
 */

import { applyTemporalDecay, DEFAULT_TEMPORAL_DECAY, type TemporalDecayConfig } from "./temporalDecay.ts";
import { mmrRerank, DEFAULT_MMR_CONFIG, type MMRConfig } from "./mmr.ts";

export interface RankedEntry {
  id: string;
  content: string;
  score: number;
  /** Unix ms. null = evergreen (no decay). */
  timestamp: number | null;
  /**
   * Stored importance in [0, 1] (MemoryEntry.importance). Optional so
   * callers that don't carry it fall back to neutral weighting. Folded
   * multiplicatively into the enhance score (importance x recency x
   * relevance) — this is what lets the outcome->memory reinforcement loop
   * (trade-journal.ts::reinforce) actually change ranking: bumping a
   * winning memory's importance lifts it here.
   */
  importance?: number;
}

export interface EnhanceConfig {
  decay: TemporalDecayConfig;
  mmr: MMRConfig;
  /** Return at most this many entries. If undefined, keep all. */
  limit?: number;
}

export const DEFAULT_ENHANCE_CONFIG: EnhanceConfig = {
  decay: DEFAULT_TEMPORAL_DECAY,
  mmr: DEFAULT_MMR_CONFIG,
};

/**
 * Map a stored importance in [0, 1] to a multiplicative weight centered on
 * neutral. importance 0.5 (the default write value) → 1.0 (no change);
 * importance 1.0 → 1.5 (boost); importance 0 → 0.5 (penalty). Undefined
 * importance is neutral so this is a strict no-op for callers that don't
 * pass it.
 */
export function importanceMultiplier(importance: number | undefined): number {
  if (importance == null || !Number.isFinite(importance)) return 1;
  const clamped = Math.max(0, Math.min(1, importance));
  return 0.5 + clamped;
}

/**
 * Apply temporal decay + MMR re-ranking to already-scored results.
 *
 * Safe to use as a drop-in tail after any existing scoring pipeline —
 * doesn't change which candidates are returned, only their order and
 * whether near-duplicates are collapsed.
 */
export function enhanceRankedResults<T extends RankedEntry>(
  results: T[],
  config: Partial<EnhanceConfig> = {},
): T[] {
  const cfg = { ...DEFAULT_ENHANCE_CONFIG, ...config };
  if (results.length === 0) return results;

  // 1. Temporal decay (recency x relevance)
  const decayed = applyTemporalDecay(results, cfg.decay);

  // 2. Fold in stored importance (importance x recency x relevance)
  const weighted = decayed.map((r) => ({
    ...r,
    score: r.score * importanceMultiplier(r.importance),
  }));

  // 3. Re-sort after decay + importance weighting
  const sorted = [...weighted].sort((a, b) => b.score - a.score);

  // 4. MMR re-ranking (diversification)
  const reranked = mmrRerank(
    sorted.map((r) => ({ id: r.id, score: r.score, content: r.content })),
    cfg.mmr,
  );
  const byId = new Map(sorted.map((r) => [r.id, r]));
  const result = reranked.map((r) => byId.get(r.id)!);

  return cfg.limit ? result.slice(0, cfg.limit) : result;
}
