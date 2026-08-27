/**
 * Liquidation Intelligence Tools (Mastra Format)
 * Aggregate market intelligence from Hyperliquid's public API
 *
 * Replaces hardcoded whale tracking with aggregate signals:
 * - Cascade risk scoring per coin
 * - Liquidation pressure detection (active squeezes)
 * - Crowding analysis (one-sided positioning)
 * - Squeeze candidate detection (price vs funding mismatch)
 *
 * Uses only the public metaAndAssetCtxs endpoint — no private keys,
 * no external APIs, no hardcoded addresses.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// ============================================================================
// Constants
// ============================================================================

const HL_INFO_API = "https://api.hyperliquid.xyz/info";
const REQUEST_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 10000; // 10 seconds

// ============================================================================
// Types (matching Hyperliquid API response)
// ============================================================================

interface HLAssetInfo {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated: boolean;
}

interface HLMeta {
  universe: HLAssetInfo[];
}

interface HLAssetCtx {
  funding: string;
  openInterest: string;
  prevDayPx: string;
  dayNtlVlm: string;
  premium: string;
  oraclePx: string;
  markPx: string;
  midPx: string;
  impactPxs: [string, string];
}

// ============================================================================
// Data Fetching (memoized)
// ============================================================================

let _cache: { meta: HLMeta; assetCtxs: HLAssetCtx[]; timestamp: number } | null = null;

async function fetchMarketData(): Promise<
  { meta: HLMeta; assetCtxs: HLAssetCtx[]; error?: undefined } | { error: string }
> {
  const now = Date.now();
  if (_cache && now - _cache.timestamp < CACHE_TTL_MS) {
    return { meta: _cache.meta, assetCtxs: _cache.assetCtxs };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(HL_INFO_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      clearTimeout(timeoutId);
      return { error: `Hyperliquid API error: ${response.status}` };
    }

    const [meta, assetCtxs] = (await response.json()) as [HLMeta, HLAssetCtx[]];
    _cache = { meta, assetCtxs, timestamp: now };
    return { meta, assetCtxs };
  } catch (error) {
    clearTimeout(timeoutId);
    return { error: `Hyperliquid API request failed: ${(error as Error).message}` };
  }
}

// ============================================================================
// Scoring Helpers
// ============================================================================

interface CascadeRiskFactors {
  fundingScore: number;
  oiVolumeScore: number;
  premiumScore: number;
  leverageScore: number;
}

function calculateCascadeRisk(
  ctx: HLAssetCtx,
  asset: HLAssetInfo,
): { score: number; factors: CascadeRiskFactors; interpretation: string } {
  const fundingRate = parseFloat(ctx.funding);
  const annualizedFunding = Math.abs(fundingRate * 3 * 365);
  const fundingScore = Math.min(annualizedFunding / 0.5, 1.0) * 100;

  const openInterest = parseFloat(ctx.openInterest);
  const dailyVolume = parseFloat(ctx.dayNtlVlm);
  const oiVolumeRatio = dailyVolume > 0 ? openInterest / dailyVolume : 0;
  const oiVolumeScore = Math.min(oiVolumeRatio / 5.0, 1.0) * 100;

  const premium = parseFloat(ctx.premium);
  const premiumScore = Math.min(Math.abs(premium) / 0.01, 1.0) * 100;

  const leverageScore = Math.min(asset.maxLeverage / 50, 1.0) * 100;

  const score = Math.round(
    fundingScore * 0.3 + oiVolumeScore * 0.25 + premiumScore * 0.25 + leverageScore * 0.2,
  );

  let interpretation: string;
  if (score > 75)
    interpretation = "Critical cascade risk — extreme leverage and crowded positioning";
  else if (score > 50) interpretation = "High cascade risk — significant deleveraging potential";
  else if (score > 25) interpretation = "Moderate cascade risk — some pressure building";
  else interpretation = "Low cascade risk — stable conditions";

  return {
    score,
    factors: {
      fundingScore: Math.round(fundingScore),
      oiVolumeScore: Math.round(oiVolumeScore),
      premiumScore: Math.round(premiumScore),
      leverageScore: Math.round(leverageScore),
    },
    interpretation,
  };
}

type PressureDirection = "long_squeeze" | "short_squeeze" | "neutral";

function detectLiquidationPressure(ctx: HLAssetCtx): {
  direction: PressureDirection;
  pressureScore: number;
  explanation: string;
} {
  const fundingRate = parseFloat(ctx.funding);
  const annualizedFunding = fundingRate * 3 * 365;
  const premium = parseFloat(ctx.premium);
  const openInterest = parseFloat(ctx.openInterest);
  const dailyVolume = parseFloat(ctx.dayNtlVlm);
  const oiVolumeRatio = dailyVolume > 0 ? openInterest / dailyVolume : 0;

  let direction: PressureDirection = "neutral";
  let pressureScore = 0;
  const reasons: string[] = [];

  // Extreme funding → crowded side being squeezed
  if (fundingRate > 0.0001 || annualizedFunding > 0.1) {
    direction = "long_squeeze";
    pressureScore += 40;
    reasons.push(`Extreme positive funding (${(annualizedFunding * 100).toFixed(1)}% annualized)`);
  } else if (fundingRate < -0.0001 || annualizedFunding < -0.1) {
    direction = "short_squeeze";
    pressureScore += 40;
    reasons.push(`Extreme negative funding (${(annualizedFunding * 100).toFixed(1)}% annualized)`);
  }

  // Premium divergence
  if (Math.abs(premium) > 0.005) {
    pressureScore += 30;
    reasons.push(`Large premium divergence (${(premium * 100).toFixed(2)}%)`);
  }

  // High OI relative to volume
  if (oiVolumeRatio > 3.0) {
    pressureScore += 30;
    reasons.push(`High OI/volume ratio (${oiVolumeRatio.toFixed(1)}x)`);
  }

  return {
    direction,
    pressureScore: Math.min(pressureScore, 100),
    explanation: reasons.length > 0 ? reasons.join("; ") : "No significant liquidation pressure",
  };
}

type CrowdDirection = "crowded_long" | "crowded_short" | "balanced";

function analyzeCrowding(ctx: HLAssetCtx): {
  direction: CrowdDirection;
  crowdingScore: number;
  implication: string;
} {
  const fundingRate = parseFloat(ctx.funding);
  const annualizedFunding = fundingRate * 3 * 365;
  const premium = parseFloat(ctx.premium);

  let direction: CrowdDirection = "balanced";
  let crowdingScore = 0;

  if (fundingRate > 0.00005) {
    direction = "crowded_long";
    crowdingScore = Math.min(Math.abs(annualizedFunding) / 0.3, 1.0) * 70;
    if (premium > 0.002) crowdingScore += 30;
  } else if (fundingRate < -0.00005) {
    direction = "crowded_short";
    crowdingScore = Math.min(Math.abs(annualizedFunding) / 0.3, 1.0) * 70;
    if (premium < -0.002) crowdingScore += 30;
  }

  crowdingScore = Math.round(Math.min(crowdingScore, 100));

  let implication: string;
  const label = direction.replace("_", " ");
  if (crowdingScore > 70) implication = `Extremely ${label} — high risk of squeeze if market turns`;
  else if (crowdingScore > 40) implication = `Moderately ${label} — watch for reversal signals`;
  else if (crowdingScore > 20) implication = `Slightly ${label} — mild directional bias`;
  else implication = "Balanced positioning — no significant crowd";

  return { direction, crowdingScore, implication };
}

// ============================================================================
// Tool 1: Cascade Risk
// ============================================================================

export const getCascadeRiskTool = createTool({
  id: "get_cascade_risk",
  description:
    "Calculate per-coin cascade/liquidation risk score (0-100) using aggregate Hyperliquid data. " +
    "Factors: funding extremes, OI-to-volume ratio, premium divergence, leverage capacity. " +
    "Use when user asks about liquidation risk, cascade potential, or market stability.",
  inputSchema: z.object({
    coin: z
      .string()
      .optional()
      .describe("Filter by coin (e.g., 'BTC', 'ETH'). Omit for all coins."),
    limit: z.number().min(1).max(50).default(10).describe("Max results (default 10)"),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    results: z
      .array(
        z.object({
          coin: z.string(),
          cascadeRiskScore: z.number(),
          factors: z.object({
            fundingScore: z.number(),
            oiVolumeScore: z.number(),
            premiumScore: z.number(),
            leverageScore: z.number(),
          }),
          interpretation: z.string(),
          currentPrice: z.string(),
          openInterest: z.string(),
          dailyVolume: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ coin, limit }) => {
    try {
      const data = await fetchMarketData();
      if ("error" in data) return { error: data.error };
      const { meta, assetCtxs } = data;

      const results = meta.universe
        .map((asset, index) => {
          const ctx = assetCtxs[index];
          if (!ctx) return null;
          if (coin && asset.name.toUpperCase() !== coin.toUpperCase()) return null;

          const risk = calculateCascadeRisk(ctx, asset);

          return {
            coin: asset.name,
            cascadeRiskScore: risk.score,
            factors: risk.factors,
            interpretation: risk.interpretation,
            currentPrice: ctx.markPx,
            openInterest: ctx.openInterest,
            dailyVolume: ctx.dayNtlVlm,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.cascadeRiskScore - a.cascadeRiskScore)
        .slice(0, limit);

      return { count: results.length, results };
    } catch (error) {
      return { error: `Failed to calculate cascade risk: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Tool 2: Liquidation Pressure
// ============================================================================

export const getLiquidationPressureTool = createTool({
  id: "get_liquidation_pressure",
  description:
    "Detect current liquidation pressure — which coins have active long or short squeezes. " +
    "Based on extreme funding rates, premium divergence, and OI concentration. " +
    "Use when user asks about squeezes, liquidations, or directional stress.",
  inputSchema: z.object({
    coin: z
      .string()
      .optional()
      .describe("Filter by coin (e.g., 'BTC', 'ETH'). Omit for all coins."),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    results: z
      .array(
        z.object({
          coin: z.string(),
          direction: z.string(),
          pressureScore: z.number(),
          explanation: z.string(),
          currentFunding: z.string(),
          annualizedFunding: z.string(),
          premium: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ coin }) => {
    try {
      const data = await fetchMarketData();
      if ("error" in data) return { error: data.error };
      const { meta, assetCtxs } = data;

      const results = meta.universe
        .map((asset, index) => {
          const ctx = assetCtxs[index];
          if (!ctx) return null;
          if (coin && asset.name.toUpperCase() !== coin.toUpperCase()) return null;

          const pressure = detectLiquidationPressure(ctx);
          if (pressure.pressureScore === 0 && !coin) return null;

          const fundingRate = parseFloat(ctx.funding);
          const annualized = fundingRate * 3 * 365;

          return {
            coin: asset.name,
            direction: pressure.direction,
            pressureScore: pressure.pressureScore,
            explanation: pressure.explanation,
            currentFunding: `${(fundingRate * 100).toFixed(4)}% per 8h`,
            annualizedFunding: `${(annualized * 100).toFixed(2)}%`,
            premium: `${(parseFloat(ctx.premium) * 100).toFixed(3)}%`,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.pressureScore - a.pressureScore);

      return { count: results.length, results };
    } catch (error) {
      return { error: `Failed to detect liquidation pressure: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Tool 3: Crowding Analysis
// ============================================================================

export const getCrowdingAnalysisTool = createTool({
  id: "get_crowding_analysis",
  description:
    "Identify coins with one-sided positioning (crowded long or crowded short). " +
    "Combines funding rate direction/magnitude with premium to score crowding. " +
    "Use to find contrarian opportunities or anticipate squeezes.",
  inputSchema: z.object({
    limit: z.number().min(1).max(50).default(10).describe("Max results (default 10)"),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    results: z
      .array(
        z.object({
          coin: z.string(),
          direction: z.string(),
          crowdingScore: z.number(),
          implication: z.string(),
          currentFunding: z.string(),
          premium: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ limit }) => {
    try {
      const data = await fetchMarketData();
      if ("error" in data) return { error: data.error };
      const { meta, assetCtxs } = data;

      const results = meta.universe
        .map((asset, index) => {
          const ctx = assetCtxs[index];
          if (!ctx) return null;

          const crowding = analyzeCrowding(ctx);
          if (crowding.crowdingScore < 20) return null;

          const fundingRate = parseFloat(ctx.funding);

          return {
            coin: asset.name,
            direction: crowding.direction,
            crowdingScore: crowding.crowdingScore,
            implication: crowding.implication,
            currentFunding: `${(fundingRate * 100).toFixed(4)}% per 8h`,
            premium: `${(parseFloat(ctx.premium) * 100).toFixed(3)}%`,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.crowdingScore - a.crowdingScore)
        .slice(0, limit);

      return { count: results.length, results };
    } catch (error) {
      return { error: `Failed to analyze crowding: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Tool 4: Squeeze Candidates
// ============================================================================

export const getSqueezeCandidatesTool = createTool({
  id: "get_squeeze_candidates",
  description:
    "Find coins most likely to experience a squeeze — price moving AGAINST the crowd. " +
    "Detects when price rises while shorts are crowded (short squeeze) or falls while longs are crowded (long squeeze). " +
    "Use to find momentum trades or avoid getting caught in squeezes.",
  inputSchema: z.object({
    limit: z.number().min(1).max(20).default(5).describe("Max results (default 5)"),
  }),
  outputSchema: z.object({
    count: z.number().optional(),
    results: z
      .array(
        z.object({
          coin: z.string(),
          type: z.string(),
          probability: z.number(),
          triggerConditions: z.array(z.string()),
          priceChange24h: z.string(),
          currentFunding: z.string(),
          crowdingScore: z.number(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async ({ limit }) => {
    try {
      const data = await fetchMarketData();
      if ("error" in data) return { error: data.error };
      const { meta, assetCtxs } = data;

      const results = meta.universe
        .map((asset, index) => {
          const ctx = assetCtxs[index];
          if (!ctx) return null;

          const markPrice = parseFloat(ctx.markPx);
          const prevDayPrice = parseFloat(ctx.prevDayPx);
          if (prevDayPrice === 0) return null;
          const priceChange = (markPrice - prevDayPrice) / prevDayPrice;

          const fundingRate = parseFloat(ctx.funding);
          const crowding = analyzeCrowding(ctx);

          let type: "short_squeeze" | "long_squeeze" | "none" = "none";
          let probability = 0;
          const triggerConditions: string[] = [];

          // Short squeeze: price rising + shorts crowded
          if (priceChange > 0.02 && fundingRate < -0.00005) {
            type = "short_squeeze";
            probability += 40;
            triggerConditions.push(
              `Price up ${(priceChange * 100).toFixed(1)}% while shorts crowded`,
            );
            if (crowding.crowdingScore > 50) {
              probability += 30;
              triggerConditions.push(`High short crowding (${crowding.crowdingScore})`);
            }
            if (Math.abs(fundingRate) > 0.0001) {
              probability += 30;
              triggerConditions.push("Extreme negative funding accelerating squeeze");
            }
          }
          // Long squeeze: price falling + longs crowded
          else if (priceChange < -0.02 && fundingRate > 0.00005) {
            type = "long_squeeze";
            probability += 40;
            triggerConditions.push(
              `Price down ${(Math.abs(priceChange) * 100).toFixed(1)}% while longs crowded`,
            );
            if (crowding.crowdingScore > 50) {
              probability += 30;
              triggerConditions.push(`High long crowding (${crowding.crowdingScore})`);
            }
            if (Math.abs(fundingRate) > 0.0001) {
              probability += 30;
              triggerConditions.push("Extreme positive funding accelerating squeeze");
            }
          }

          if (probability === 0) return null;

          return {
            coin: asset.name,
            type,
            probability: Math.min(probability, 100),
            triggerConditions,
            priceChange24h: `${(priceChange * 100).toFixed(2)}%`,
            currentFunding: `${(fundingRate * 100).toFixed(4)}% per 8h`,
            crowdingScore: crowding.crowdingScore,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, limit);

      return { count: results.length, results };
    } catch (error) {
      return { error: `Failed to find squeeze candidates: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const liquidationIntelligenceTools = {
  get_cascade_risk: getCascadeRiskTool,
  get_liquidation_pressure: getLiquidationPressureTool,
  get_crowding_analysis: getCrowdingAnalysisTool,
  get_squeeze_candidates: getSqueezeCandidatesTool,
};
