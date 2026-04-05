/**
 * SynthData API Client
 *
 * Probabilistic prediction data for crypto, gold, and tokenized equities.
 * Uses native fetch + withRetry for resilience. Caches responses for 5 min.
 *
 * Required env var: SYNTHDATA_API_KEY
 */

import { withRetry } from "../../retry.ts";
import { Cache } from "../../platform/cache/cache.ts";
import {
  SYNTHDATA_ENV_KEYS,
  SYNTHDATA_BASE_URL,
  SYNTHDATA_TIMEOUT,
  SYNTHDATA_CACHE_TTL,
  type PredictionPercentilesResponse,
  type VolatilityResponse,
  type OptionPricingResponse,
  type LiquidationResponse,
  type LPBoundsResponse,
  type LPProbabilitiesResponse,
  type LeaderboardResponse,
} from "./types.ts";

// ============================================================================
// Configuration Check
// ============================================================================

export function isSynthDataConfigured(): boolean {
  return Boolean(process.env[SYNTHDATA_ENV_KEYS.API_KEY]);
}

// ============================================================================
// Response Cache (5-min TTL, matches prediction interval granularity)
// ============================================================================

const cache = new Cache<unknown>({
  defaultTtl: SYNTHDATA_CACHE_TTL,
  maxEntries: 200,
  updateTtlOnAccess: false,
});

// ============================================================================
// HTTP Helper
// ============================================================================

function getHeaders(): Record<string, string> {
  const apiKey = process.env[SYNTHDATA_ENV_KEYS.API_KEY];
  if (!apiKey) throw new Error("SYNTHDATA_API_KEY not configured");
  return {
    Authorization: `Apikey ${apiKey}`,
    Accept: "application/json",
  };
}

/**
 * Core GET helper — fetch with retry, timeout, and caching.
 * withRetry already handles 429 and 5xx status codes.
 */
async function synthGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  cacheKey?: string,
): Promise<T> {
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached as T;
  }

  const url = new URL(path, SYNTHDATA_BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const result = await withRetry(
    async () => {
      const resp = await fetch(url.toString(), {
        method: "GET",
        headers: getHeaders(),
        signal: AbortSignal.timeout(SYNTHDATA_TIMEOUT),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        const err = new Error(
          `SynthData API ${resp.status}: ${resp.statusText}${body ? ` — ${body}` : ""}`,
        );
        (err as Error & { status: number }).status = resp.status;
        throw err;
      }

      return resp.json() as Promise<T>;
    },
    { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
  );

  if (cacheKey) {
    cache.set(cacheKey, result);
  }

  return result;
}

// ============================================================================
// Public API Functions
// ============================================================================

/** Probability distributions of future prices (5th → 95th percentiles at 5-min intervals) */
export async function getPredictionPercentiles(
  asset: string,
  days = 14,
  limit = 10,
): Promise<PredictionPercentilesResponse> {
  return synthGet<PredictionPercentilesResponse>(
    "/insights/prediction-percentiles",
    { asset, days, limit },
    `percentiles:${asset}:${days}:${limit}`,
  );
}

/** Forecast vs realized volatility comparison */
export async function getVolatility(
  asset: string,
  days = 14,
  limit = 10,
): Promise<VolatilityResponse> {
  return synthGet<VolatilityResponse>(
    "/insights/volatility",
    { asset, days, limit },
    `volatility:${asset}:${days}:${limit}`,
  );
}

/** Theoretical option prices (calls/puts) by strike */
export async function getOptionPricing(
  asset: string,
): Promise<OptionPricingResponse> {
  return synthGet<OptionPricingResponse>(
    "/insights/option-pricing",
    { asset },
    `options:${asset}`,
  );
}

/** Long/short liquidation probabilities at 24h horizon */
export async function getLiquidation(
  asset: string,
): Promise<LiquidationResponse> {
  return synthGet<LiquidationResponse>(
    "/insights/liquidation",
    { asset },
    `liquidation:${asset}`,
  );
}

/** Optimal Uniswap V3 LP ranges with impermanent loss estimates */
export async function getLPBounds(asset: string): Promise<LPBoundsResponse> {
  return synthGet<LPBoundsResponse>(
    "/insights/lp-bounds",
    { asset },
    `lp-bounds:${asset}`,
  );
}

/** Cumulative probability of price at each level within 24h */
export async function getLPProbabilities(
  asset: string,
): Promise<LPProbabilitiesResponse> {
  return synthGet<LPProbabilitiesResponse>(
    "/insights/lp-probabilities",
    { asset },
    `lp-probs:${asset}`,
  );
}

/** Top-performing AI prediction miners on SynthData leaderboard */
export async function getLeaderboard(
  asset: string,
  days = 14,
  limit = 10,
): Promise<LeaderboardResponse> {
  return synthGet<LeaderboardResponse>(
    "/v2/leaderboard/latest",
    { asset, days, limit },
    `leaderboard:${asset}:${days}:${limit}`,
  );
}
