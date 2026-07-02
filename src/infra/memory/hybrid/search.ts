/**
 * Hybrid Memory Search
 *
 * Combines three signals to rank memory entries:
 *   1. BM25-lite keyword scoring (direct term overlap)
 *   2. TF-IDF cosine similarity (semantic-ish without embeddings)
 *   3. Temporal decay (recent entries weighted higher)
 * Then applies MMR re-ranking to diversify results.
 *
 * No vector DB required — Gordon's memory is modest-volume (thousands of
 * entries), so pure in-memory scoring is sufficient and deterministic.
 *
 * Use this to query trade reflections, past strategies, prior analyses,
 * or any stored memory where "similar + recent + diverse" matters.
 */

import { applyTemporalDecay, DEFAULT_TEMPORAL_DECAY, type TemporalDecayConfig } from "./temporalDecay.ts";
import { mmrRerank, DEFAULT_MMR_CONFIG, type MMRConfig } from "./mmr.ts";
import { filterAsOf, type KnownAt } from "../../../core/memory/asOf.ts";

export interface MemoryEntry {
  id: string;
  content: string;
  /**
   * Unix ms timestamp (VALID time — when the fact was true), or null if the
   * entry is evergreen. Drives temporal decay.
   */
  timestamp: number | null;
  /**
   * Known-at / transaction time (Unix ms) — when this record was LEARNED.
   * Used only by the opt-in as-of guard for no-lookahead recall. Defaults to
   * `timestamp` when omitted; null means evergreen (always visible).
   */
  knownAt?: number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemorySearchResult extends MemoryEntry {
  score: number;
  /** Individual signal contributions, for debugging/introspection. */
  breakdown?: { keyword: number; tfidf: number; decay: number };
}

export interface HybridSearchConfig {
  /** Number of results to return after ranking. */
  limit: number;
  /** Keyword scoring weight. Default 0.4 */
  keywordWeight: number;
  /** TF-IDF cosine weight. Default 0.6 */
  tfidfWeight: number;
  temporalDecay: TemporalDecayConfig;
  mmr: MMRConfig;
  /** Minimum score (after decay) to include in results. */
  minScore: number;
  /**
   * Point-in-time (as-of) recall bound — Unix ms, ISO string, or null/unset.
   * When set, excludes any entry LEARNED after this instant (known-at > asOf),
   * enforcing no-lookahead for a decision made at `asOf`. An entry's known-at
   * falls back to its `timestamp` when `knownAt` is absent; evergreen entries
   * (null) stay visible. Opt-in: unset leaves recall unchanged.
   */
  asOf?: KnownAt;
}

export const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  limit: 10,
  keywordWeight: 0.4,
  tfidfWeight: 0.6,
  temporalDecay: DEFAULT_TEMPORAL_DECAY,
  mmr: DEFAULT_MMR_CONFIG,
  minScore: 0.01,
};

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "this", "that", "these",
  "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
  "who", "when", "where", "why", "how", "and", "but", "or", "nor", "for",
  "yet", "so", "at", "by", "in", "on", "to", "with", "of", "from",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function keywordScore(queryTokens: string[], entryTokens: string[]): number {
  if (queryTokens.length === 0 || entryTokens.length === 0) return 0;
  const entrySet = new Set(entryTokens);
  let hits = 0;
  for (const qt of queryTokens) if (entrySet.has(qt)) hits++;
  return hits / queryTokens.length;
}

/**
 * Cheap TF-IDF cosine similarity across the corpus.
 * Not as good as embeddings, but no external dependency + deterministic.
 */
function buildIdfMap(entries: MemoryEntry[]): Map<string, number> {
  const df = new Map<string, number>();
  const n = entries.length;
  for (const e of entries) {
    const uniq = new Set(tokenize(e.content));
    for (const t of uniq) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, count] of df) {
    idf.set(t, Math.log((n + 1) / (count + 1)) + 1);
  }
  return idf;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = termFrequency(tokens);
  const vec = new Map<string, number>();
  const total = tokens.length || 1;
  for (const [t, count] of tf) {
    const idfVal = idf.get(t) ?? 1;
    vec.set(t, (count / total) * idfVal);
  }
  return vec;
}

function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [, v] of a) magA += v * v;
  for (const [, v] of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const [t, v] of smaller) {
    const other = larger.get(t);
    if (other) dot += v * other;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function hybridSearch(
  query: string,
  entries: MemoryEntry[],
  config: Partial<HybridSearchConfig> = {},
): MemorySearchResult[] {
  const cfg = { ...DEFAULT_HYBRID_CONFIG, ...config };
  if (entries.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // No-lookahead guard: drop entries learned after the as-of decision time.
  // Known-at falls back to the valid-time `timestamp` when unset.
  const visible = filterAsOf(
    entries,
    cfg.asOf,
    (e) => (e.knownAt !== undefined ? e.knownAt : e.timestamp),
  );
  if (visible.length === 0) return [];
  entries = visible;

  const idf = buildIdfMap(entries);
  const queryVec = tfidfVector(queryTokens, idf);

  // Score all entries
  const scored: MemorySearchResult[] = entries.map((entry) => {
    const entryTokens = tokenize(entry.content);
    const entryVec = tfidfVector(entryTokens, idf);
    const kw = keywordScore(queryTokens, entryTokens);
    const tfidf = cosineSim(queryVec, entryVec);
    const combined = cfg.keywordWeight * kw + cfg.tfidfWeight * tfidf;
    return {
      ...entry,
      score: combined,
      breakdown: { keyword: kw, tfidf, decay: 1 },
    };
  });

  // Apply temporal decay
  const decayed = applyTemporalDecay(scored, cfg.temporalDecay);
  for (const r of decayed) {
    if (r.breakdown) r.breakdown.decay = r.score / (scored.find((s) => s.id === r.id)?.score || 1);
  }

  // Filter by minScore and sort
  const filtered = decayed
    .filter((r) => r.score >= cfg.minScore)
    .sort((a, b) => b.score - a.score);

  // Over-fetch before MMR, then trim to limit
  const pool = filtered.slice(0, cfg.limit * 3);
  const reranked = mmrRerank(
    pool.map((r) => ({ id: r.id, score: r.score, content: r.content })),
    cfg.mmr,
  );
  const poolById = new Map(pool.map((r) => [r.id, r]));
  return reranked.slice(0, cfg.limit).map((r) => poolById.get(r.id)!);
}
