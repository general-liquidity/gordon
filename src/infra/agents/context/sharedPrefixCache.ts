/**
 * Shared Prefix Cache
 *
 * Caches the stable portion of the system prompt (capability truth,
 * tool glossary, project context) so that sub-agents (Executor, Researcher)
 * can reuse it without rebuilding. Exploits Anthropic's prompt cache
 * discount — if the prefix bytes are identical, subsequent calls get
 * 90% token cost reduction.
 *
 * Claude Code pattern: Fork agents thread the parent's rendered system
 * prompt to preserve byte-exact matching. We can't fully replicate that
 * within Mastra, but caching the stable text block and sharing it across
 * agent spawns within the same interaction achieves most of the benefit.
 *
 * TTL: 5 minutes (Anthropic prompt cache window). After TTL, the next
 * agent spawn rebuilds and re-caches.
 */

// ============================================================================
// Types
// ============================================================================

export interface CachedPrefix {
  /** The stable system prompt text (before the DYNAMIC_BOUNDARY). */
  stableText: string;
  /** Hash of the text for quick equality checks. */
  hash: string;
  /** When this prefix was built. */
  builtAt: number;
  /** TTL in ms (default 5 min to match Anthropic cache window). */
  ttlMs: number;
  /** Number of times this cache entry was hit. */
  hits: number;
}

export interface PrefixCacheStats {
  entries: number;
  totalHits: number;
  oldestEntryAge: number;
}

// ============================================================================
// Cache
// ============================================================================

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

const prefixCache = new Map<string, CachedPrefix>();

function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/**
 * Get a cached stable prefix by key. Returns null if expired or missing.
 */
export function getCachedPrefix(key: string): CachedPrefix | null {
  const entry = prefixCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.builtAt > entry.ttlMs) {
    prefixCache.delete(key);
    return null;
  }
  entry.hits++;
  return entry;
}

/**
 * Store a stable prefix. Key should be agent-scoped (e.g., "gordon", "researcher").
 */
export function setCachedPrefix(key: string, stableText: string, ttlMs: number = DEFAULT_TTL_MS): CachedPrefix {
  const entry: CachedPrefix = {
    stableText,
    hash: simpleHash(stableText),
    builtAt: Date.now(),
    ttlMs,
    hits: 0,
  };
  prefixCache.set(key, entry);
  return entry;
}

/**
 * Check if a stable prefix matches a cached version (byte-exact).
 * If so, the caller can skip rebuilding and reuse the cached version.
 */
export function matchesCachedPrefix(key: string, candidateText: string): boolean {
  const entry = getCachedPrefix(key);
  if (!entry) return false;
  return entry.hash === simpleHash(candidateText) && entry.stableText === candidateText;
}

/**
 * Get prefix cache stats for debugging/observability.
 */
export function getPrefixCacheStats(): PrefixCacheStats {
  let totalHits = 0;
  let oldestAge = 0;
  const now = Date.now();
  for (const entry of prefixCache.values()) {
    totalHits += entry.hits;
    const age = now - entry.builtAt;
    if (age > oldestAge) oldestAge = age;
  }
  return { entries: prefixCache.size, totalHits, oldestEntryAge: oldestAge };
}

/** Clear the prefix cache (session reset). */
export function resetPrefixCache(): void {
  prefixCache.clear();
}
