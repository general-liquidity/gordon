/**
 * SynthData Integration
 *
 * AI-powered probabilistic predictions, volatility forecasts, options pricing,
 * liquidation risk, and LP optimization.
 */

export {
  SYNTHDATA_ENV_KEYS,
  SYNTHDATA_BASE_URL,
  SYNTHDATA_ASSETS,
  SYNTHDATA_CACHE_TTL,
  type SynthDataAsset,
  type PredictionPercentilesResponse,
  type VolatilityResponse,
  type OptionPricingResponse,
  type LiquidationResponse,
  type LPBoundsResponse,
  type LPProbabilitiesResponse,
  type LeaderboardResponse,
} from "./types.ts";

export {
  isSynthDataConfigured,
  getPredictionPercentiles,
  getVolatility,
  getOptionPricing,
  getLiquidation,
  getLPBounds,
  getLPProbabilities,
  getLeaderboard,
} from "./client.ts";
