/**
 * SynthData Prediction & Analytics Tools
 * Mastra createTool() wrappers for SynthData API endpoints
 *
 * Tools:
 * - synthdata_prediction_percentiles: Price probability cone (5th → 95th)
 * - synthdata_volatility: Forecast vs realized volatility
 * - synthdata_option_pricing: Theoretical call/put prices by strike
 * - synthdata_liquidation: Long/short liquidation probabilities
 * - synthdata_lp_bounds: Optimal Uniswap V3 LP ranges
 * - synthdata_lp_probabilities: Price level probability distributions
 * - synthdata_leaderboard: Top-performing AI prediction miners
 *
 * All tools gracefully handle the case where SYNTHDATA_API_KEY is not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  isSynthDataConfigured,
  getPredictionPercentiles,
  getVolatility,
  getOptionPricing,
  getLiquidation,
  getLPBounds,
  getLPProbabilities,
  getLeaderboard,
  SYNTHDATA_ASSETS,
} from "../../external/synthdata/index.ts";

// ============================================================================
// Shared
// ============================================================================

const ASSET_DESC = `Asset symbol. Supported: ${SYNTHDATA_ASSETS.join(", ")}`;
const NOT_CONFIGURED =
  "SynthData not configured. Set SYNTHDATA_API_KEY environment variable.";

const outputSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Tools
// ============================================================================

const synthDataPredictionPercentilesTool = createTool({
  id: "synthdata_prediction_percentiles",
  description:
    "Get SynthData AI probabilistic price predictions — the cone of likely future prices. " +
    "Returns 5th, 25th, 50th (median), 75th, and 95th percentile price paths at 5-minute intervals. " +
    "Use this to understand the probability-weighted range of where price could go. " +
    "Supports BTC, ETH, SOL, XAU (gold), and tokenized equities (SPYX, NVDAX, TSLAX, AAPLX, GOOGLX).",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
    days: z.number().default(14).describe("Lookback window for miner ranking (default 14)"),
    limit: z.number().default(10).describe("Number of top miners to aggregate (default 10)"),
  }),
  outputSchema,
  execute: async ({ asset, days, limit }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getPredictionPercentiles(asset, days, limit);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const synthDataVolatilityTool = createTool({
  id: "synthdata_volatility",
  description:
    "Get SynthData volatility analysis — forecast vs realized volatility comparison. " +
    "Shows if current volatility is above or below AI predictions, useful for regime detection, " +
    "options valuation, and risk adjustment. Returns forecast mean, realized mean, and time series.",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
    days: z.number().default(14).describe("Lookback window (default 14)"),
    limit: z.number().default(10).describe("Top miners to aggregate (default 10)"),
  }),
  outputSchema,
  execute: async ({ asset, days, limit }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getVolatility(asset, days, limit);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const synthDataOptionPricingTool = createTool({
  id: "synthdata_option_pricing",
  description:
    "Get SynthData theoretical option prices — call and put valuations by strike from Monte Carlo simulations. " +
    "Use for options strategy construction, mispricing detection (compare vs market), and implied sentiment analysis.",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
  }),
  outputSchema,
  execute: async ({ asset }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getOptionPricing(asset);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const synthDataLiquidationTool = createTool({
  id: "synthdata_liquidation",
  description:
    "Get SynthData liquidation probability analysis — probability of long and short liquidations at 24h horizon. " +
    "Critical for risk assessment of leveraged positions. Shows liquidation probability under various price scenarios.",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
  }),
  outputSchema,
  execute: async ({ asset }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getLiquidation(asset);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const synthDataLPBoundsTool = createTool({
  id: "synthdata_lp_bounds",
  description:
    "Get SynthData optimal Uniswap V3 LP ranges — AI-recommended price bounds with impermanent loss estimates. " +
    "Shows optimal lower/upper bounds, probability of staying in range, expected duration, and projected IL. " +
    "Use for DeFi liquidity provision planning and range-setting.",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
  }),
  outputSchema,
  execute: async ({ asset }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getLPBounds(asset);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const synthDataLPProbabilitiesTool = createTool({
  id: "synthdata_lp_probabilities",
  description:
    "Get SynthData price level probabilities — cumulative probability of price being above or below each level within 24h. " +
    "Use for setting LP range bounds, stop-loss levels, and take-profit targets based on probabilistic analysis.",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
  }),
  outputSchema,
  execute: async ({ asset }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getLPProbabilities(asset);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

const synthDataLeaderboardTool = createTool({
  id: "synthdata_leaderboard",
  description:
    "Get SynthData AI miner leaderboard — top-performing prediction models ranked by accuracy (CRPS score). " +
    "Shows which AI forecasters are currently most accurate for a given asset.",
  inputSchema: z.object({
    asset: z.string().describe(ASSET_DESC),
    days: z.number().default(14).describe("Ranking period in days (default 14)"),
    limit: z.number().default(10).describe("Number of top miners to return (default 10)"),
  }),
  outputSchema,
  execute: async ({ asset, days, limit }) => {
    if (!isSynthDataConfigured()) return { success: false, error: NOT_CONFIGURED };
    try {
      const data = await getLeaderboard(asset, days, limit);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  },
});

// ============================================================================
// Export as keyed object (Mastra tool format)
// ============================================================================

export const synthDataTools = {
  synthdata_prediction_percentiles: synthDataPredictionPercentilesTool,
  synthdata_volatility: synthDataVolatilityTool,
  synthdata_option_pricing: synthDataOptionPricingTool,
  synthdata_liquidation: synthDataLiquidationTool,
  synthdata_lp_bounds: synthDataLPBoundsTool,
  synthdata_lp_probabilities: synthDataLPProbabilitiesTool,
  synthdata_leaderboard: synthDataLeaderboardTool,
};
