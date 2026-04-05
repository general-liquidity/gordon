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

  // 1. Temporal decay
  const decayed = applyTemporalDecay(results, cfg.decay);

  // 2. Re-sort after decay
  const sorted = [...decayed].sort((a, b) => b.score - a.score);

  // 3. MMR re-ranking (diversification)
  const reranked = mmrRerank(
    sorted.map((r) => ({ id: r.id, score: r.score, content: r.content })),
    cfg.mmr,
  );
  const byId = new Map(sorted.map((r) => [r.id, r]));
  const result = reranked.map((r) => byId.get(r.id)!);

  return cfg.limit ? result.slice(0, cfg.limit) : result;
}
