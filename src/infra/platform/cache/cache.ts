/**
 * In-Memory Cache with TTL
 * Provides caching for expensive operations
 */

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Default TTL in milliseconds */
  defaultTtl: number;
  /** Maximum number of entries */
  maxEntries: number;
  /** Whether to update TTL on access */
  updateTtlOnAccess: boolean;
  /** Clock used for TTL bookkeeping. Defaults to Date.now. */
  now?: () => number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  hitRate: number;
}

/**
 * Generic in-memory cache with TTL support
 */
export class Cache<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private stats = { hits: 0, misses: 0 };
  private readonly now: () => number;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      defaultTtl: config.defaultTtl ?? 60000, // 1 minute default
      maxEntries: config.maxEntries ?? 1000,
      updateTtlOnAccess: config.updateTtlOnAccess ?? false,
    };
    this.now = config.now ?? Date.now;
  }

  /**
   * Get a value from the cache
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    if (this.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    this.stats.hits++;

    // Update TTL on access if configured
    if (this.config.updateTtlOnAccess) {
      entry.expiresAt = this.now() + this.config.defaultTtl;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache
   */
  set(key: string, value: T, ttl?: number): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const now = this.now();
    this.cache.set(key, {
      value,
      expiresAt: now + (ttl ?? this.config.defaultTtl),
      createdAt: now,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Get or set - returns cached value or computes and caches
   */
  async getOrSet(key: string, compute: () => T | Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await compute();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      entries: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    const now = this.now();
    let pruned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Evict oldest entries to make room
   */
  private evictOldest(): void {
    // Find and remove the oldest 10% of entries
    const toRemove = Math.max(1, Math.floor(this.config.maxEntries * 0.1));
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, toRemove);

    for (const [key] of entries) {
      this.cache.delete(key);
    }
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get size of cache
   */
  get size(): number {
    return this.cache.size;
  }
}

/**
 * Create a cache with a specific type
 */
export function createCache<T>(config?: Partial<CacheConfig>): Cache<T> {
  return new Cache<T>(config);
}
