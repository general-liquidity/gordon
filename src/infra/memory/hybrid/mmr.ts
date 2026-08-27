/**
 * Maximal Marginal Relevance (MMR) Re-ranking
 *
 * Balances relevance with diversity: iteratively picks results that maximize
 *   λ * relevance − (1−λ) * max_similarity_to_already_selected
 *
 * Prevents pure vector/keyword search from returning a top-10 that's really
 * 10 variants of the same trade/note. Crucial for trading memory where
 * "show me similar losing trades" should surface diverse lessons, not the
 * same lesson 10 times.
 *
 * @see Carbonell & Goldstein, "The Use of MMR, Diversity-Based Reranking" (1998)
 */

export interface MMRConfig {
  enabled: boolean;
  /** 1 = pure relevance; 0 = pure diversity; 0.7 is a good default. */
  lambda: number;
}

export const DEFAULT_MMR_CONFIG: MMRConfig = { enabled: true, lambda: 0.7 };

export interface MMRCandidate {
  id: string;
  score: number;
  content: string;
}

function tokenize(text: string): Set<string> {
  const toks = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(toks);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const t of smaller) if (larger.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function maxSimToSelected(
  candidate: MMRCandidate,
  selected: MMRCandidate[],
  cache: Map<string, Set<string>>,
): number {
  if (selected.length === 0) return 0;
  let maxSim = 0;
  const candTokens = cache.get(candidate.id) ?? tokenize(candidate.content);
  for (const sel of selected) {
    const selTokens = cache.get(sel.id) ?? tokenize(sel.content);
    const sim = jaccard(candTokens, selTokens);
    if (sim > maxSim) maxSim = sim;
  }
  return maxSim;
}

export function mmrRerank<T extends MMRCandidate>(
  items: T[],
  config: Partial<MMRConfig> = {},
): T[] {
  const { enabled = DEFAULT_MMR_CONFIG.enabled, lambda = DEFAULT_MMR_CONFIG.lambda } = config;
  if (!enabled || items.length <= 1) return [...items];

  const clamped = Math.max(0, Math.min(1, lambda));
  if (clamped === 1) return [...items].sort((a, b) => b.score - a.score);

  const cache = new Map<string, Set<string>>();
  for (const i of items) cache.set(i.id, tokenize(i.content));

  const maxS = Math.max(...items.map((i) => i.score));
  const minS = Math.min(...items.map((i) => i.score));
  const range = maxS - minS;
  const norm = (s: number) => (range === 0 ? 1 : (s - minS) / range);

  const selected: T[] = [];
  const remaining = new Set(items);

  while (remaining.size > 0) {
    let best: T | null = null;
    let bestMMR = -Infinity;
    for (const candidate of remaining) {
      const rel = norm(candidate.score);
      const sim = maxSimToSelected(candidate, selected, cache);
      const mmr = clamped * rel - (1 - clamped) * sim;
      if (mmr > bestMMR || (mmr === bestMMR && candidate.score > (best?.score ?? -Infinity))) {
        bestMMR = mmr;
        best = candidate;
      }
    }
    if (!best) break;
    selected.push(best);
    remaining.delete(best);
  }
  return selected;
}
