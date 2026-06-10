/**
 * Lazy Loading + Feature Flags for Heavy Modules
 *
 * Claude Code pattern: heavy modules are loaded on first use, not at import
 * time. Feature flags gate entire module trees at compile time for zero-cost
 * when disabled.
 *
 * For Gordon:
 *   - Exchange adapters (CCXT venues) loaded on first trade
 *   - Onchain data / wallet-intel sources loaded on first query
 *   - Data sources (SEC, X Search) loaded on first query
 *   - OAuth flow loaded only when user runs /oauth
 *
 * This module provides lazy<T>() — a type-safe lazy initializer that defers
 * the import() call until .get() is called.
 */

// ============================================================================
// Lazy Loader
// ============================================================================

export interface LazyModule<T> {
  /** Load the module (first call imports, subsequent calls return cached). */
  get(): Promise<T>;
  /** Check if the module has been loaded. */
  isLoaded(): boolean;
  /** Force unload (for testing or memory pressure). */
  unload(): void;
}

/**
 * Create a lazy-loaded module wrapper.
 *
 * @example
 * ```ts
 * const oauthFlow = lazy(() => import("../auth/oauth-flow.ts"));
 * // ... later, on first use:
 * const { startOAuth } = await oauthFlow.get();
 * ```
 */
export function lazy<T>(importer: () => Promise<T>): LazyModule<T> {
  let cached: T | null = null;
  let loading: Promise<T> | null = null;

  return {
    async get(): Promise<T> {
      if (cached) return cached;
      if (loading) return loading;

      loading = importer().then((mod) => {
        cached = mod;
        loading = null;
        return mod;
      }).catch((err) => {
        loading = null;
        throw err;
      });

      return loading;
    },

    isLoaded(): boolean {
      return cached !== null;
    },

    unload(): void {
      cached = null;
      loading = null;
    },
  };
}

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Runtime feature flags — checked at module load time.
 * Set via GORDON_FEATURES env var (comma-separated) or .gordon/features.json.
 */

const activeFlags = new Set<string>();
let flagsInitialized = false;

function initFlags(): void {
  if (flagsInitialized) return;
  flagsInitialized = true;

  // From environment
  const envFlags = process.env.GORDON_FEATURES?.split(",").map((f) => f.trim()).filter(Boolean) ?? [];
  for (const flag of envFlags) activeFlags.add(flag);

  // From config file
  try {
    const { existsSync, readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const flagFile = join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".gordon", "features.json");
    if (existsSync(flagFile)) {
      const parsed = JSON.parse(readFileSync(flagFile, "utf-8")) as Record<string, boolean>;
      for (const [flag, enabled] of Object.entries(parsed)) {
        if (enabled) activeFlags.add(flag);
        else activeFlags.delete(flag);
      }
    }
  } catch {
    // Non-critical
  }
}

/**
 * Check if a feature flag is active.
 */
export function feature(flag: string): boolean {
  initFlags();
  return activeFlags.has(flag);
}

/**
 * Conditionally import a module only if a feature flag is active.
 * Returns null if the flag is disabled.
 */
export function featureModule<T>(flag: string, importer: () => Promise<T>): LazyModule<T | null> {
  if (!feature(flag)) {
    return {
      get: async () => null,
      isLoaded: () => true,
      unload: () => {},
    };
  }
  return lazy(importer);
}

// ============================================================================
// Pre-Built Lazy Modules for Gordon
// ============================================================================

/** Lazy OAuth flow. */
export const lazyOAuth = lazy(() => import("../auth/oauth-flow.ts"));

/** Lazy SEC data sources. */
export const lazySECInsider = lazy(() => import("../data/providers/sec/sec-insider.ts"));
export const lazySECSegments = lazy(() => import("../data/providers/sec/sec-segments.ts"));

/** Lazy X Search. */
export const lazyXSearch = lazy(() => import("../data/providers/social/xSearch.ts"));

/** Lazy stock screener. */
export const lazyStockScreener = lazy(() => import("../data/providers/stockScreener.ts"));
