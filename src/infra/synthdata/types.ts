/**
 * SynthData Integration Types & Constants
 *
 * Probabilistic prediction and analytics data provider.
 * Bittensor Subnet 50 — 200+ competing AI models generating price forecasts.
 *
 * API: https://api.synthdata.co
 * Auth: Header `Authorization: Apikey YOUR_API_KEY`
 * Docs: https://docs.synthdata.co
 */

// ============================================================================
// Environment Variable Names
// ============================================================================

export const SYNTHDATA_ENV_KEYS = {
  API_KEY: "SYNTHDATA_API_KEY",
} as const;

// ============================================================================
// Configuration
// ============================================================================

export const SYNTHDATA_BASE_URL = "https://api.synthdata.co";

/** Request timeout (ms) */
export const SYNTHDATA_TIMEOUT = 15_000;

/** Cache TTL — 5 min, matches SynthData's 5-minute prediction interval granularity */
export const SYNTHDATA_CACHE_TTL = 300_000;

/**
 * Supported assets on SynthData.
 * Crypto, gold, and tokenized equities (24/7 trading via Pyth price feeds).
 */
export const SYNTHDATA_ASSETS = [
  "BTC",
  "ETH",
  "SOL",
  "XAU",
  "SPYX",
  "NVDAX",
  "TSLAX",
  "AAPLX",
  "GOOGLX",
] as const;

export type SynthDataAsset = (typeof SYNTHDATA_ASSETS)[number];

// ============================================================================
// Response Types
// ============================================================================

/** Prediction percentiles response — probability distributions at 5-min intervals */
export interface PredictionPercentilesResponse {
  current_price: number;
  forecast_future: {
    percentiles: Record<string, number[]>;
    timestamps: number[];
  };
  forecast_past?: {
    percentiles: Record<string, number[]>;
    timestamps: number[];
  };
  actual_prices?: number[];
}

/** Volatility insight */
export interface VolatilityResponse {
  current_price: number;
  forecast_future: {
    mean: number;
    values: number[];
  };
  forecast_past: {
    mean: number;
    values: number[];
  };
  realized: {
    mean: number;
    prices: number[];
    returns: number[];
    volatility: number[];
  };
}

/** Option pricing response */
export interface OptionPricingResponse {
  current_price: number;
  expiration: string;
  strikes: Array<{
    strike: number;
    call_price: number;
    put_price: number;
  }>;
}

/** Liquidation probability response */
export interface LiquidationResponse {
  current_price: number;
  long_prob_24h: number;
  short_prob_24h: number;
  scenarios: Array<{
    price_change: number;
    long_prob: number;
    short_prob: number;
  }>;
}

/** LP bounds (Uniswap V3 range optimization) */
export interface LPBoundsResponse {
  current_price: number;
  bounds: Array<{
    lower: number;
    upper: number;
    probability_in_range: number;
    expected_duration_hours: number;
    impermanent_loss_pct: number;
  }>;
}

/** LP probability levels */
export interface LPProbabilitiesResponse {
  current_price: number;
  probabilities: Array<{
    price_level: number;
    prob_above: number;
    prob_below: number;
  }>;
}

/** Leaderboard miner entry */
export interface LeaderboardResponse {
  miners: Array<{
    uid: number;
    rank: number;
    score: number;
  }>;
}
