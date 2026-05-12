// ============================================================================
// Prompt Cache — Cache system prompts and tool definitions to reduce API costs
//
// 1-hour TTL. Only cache stable content (system prompt, tool schemas).
// Estimates token counts and tracks hit/miss rate for cost analysis.
// ============================================================================

export interface CacheEntry {
  key: string;
  content: string;
  tokenEstimate: number;
  cachedAt: number;
  ttlMs: number;
  hits: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// Rough estimate: ~4 chars per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class PromptCache {
  private cache: Map<string, CacheEntry> = new Map();
  private misses = 0;
  private totalHits = 0;

  set(key: string, content: string, ttlMs?: number): void {
    this.cache.set(key, {
      key,
      content,
      tokenEstimate: estimateTokens(content),
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? DEFAULT_TTL_MS,
      hits: 0,
    });
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    // Check expiry
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    entry.hits++;
    this.totalHits++;
    return entry.content;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.misses = 0;
    this.totalHits = 0;
  }

  getStats(): { entries: number; totalTokens: number; hitRate: number; savings: number } {
    let totalTokens = 0;
    let savingsTokens = 0;

    for (const entry of this.cache.values()) {
      totalTokens += entry.tokenEstimate;
      savingsTokens += entry.tokenEstimate * entry.hits;
    }

    const totalRequests = this.totalHits + this.misses;
    const hitRate = totalRequests > 0 ? this.totalHits / totalRequests : 0;

    return {
      entries: this.cache.size,
      totalTokens,
      hitRate: Math.round(hitRate * 1000) / 1000,
      savings: savingsTokens,
    };
  }
}

let instance: PromptCache | null = null;

export function getPromptCache(): PromptCache {
  if (!instance) instance = new PromptCache();
  return instance;
}
