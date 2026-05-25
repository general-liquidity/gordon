/**
 * Diagnostic Tools — three options-trading-inspired primitives translated
 * to Gordon's spot/perp/DeFi domain.
 *
 *   - `get_pnl_distribution_shape` — convexity verdict on a series of
 *     realized trade P&Ls. Spot-market analog of long/short convexity.
 *   - `get_vol_forecast_calibration` — bias/MAE/RMSE on Gordon's own
 *     volatility forecasts. Spot-market analog of IV-vs-RV.
 *   - `detect_correlation_breakdown` — cross-symbol Pearson with z-score
 *     vs baseline. Spot-market analog of dispersion trading (signal,
 *     not instrument).
 *
 * All three are PURE READ tools — they aggregate or compute over data
 * the caller supplies (or that's already in Gordon's persistence). None
 * place trades, modify state, or mutate audit. Safe to expose to
 * Gordon (orchestrator) and Researcher (read-only research agent).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  computePnlDistributionShape,
  summarizePnlDistributionShape,
} from "../../../trading/analytics/pnlDistributionShape.ts";
import {
  getVolCalibration,
  summarizeVolCalibration,
} from "../../../trading/analytics/volForecastCalibration.ts";
import {
  detectCorrelationBreakdown,
  summarizeBreakdownReport,
  type ReturnSeries,
} from "../../../../core/alpha/correlationBreakdown.ts";

// ============================================================================
// get_pnl_distribution_shape
// ============================================================================

export const getPnlDistributionShapeTool = createTool({
  id: "get_pnl_distribution_shape",
  description: [
    "Compute the shape of a P&L distribution from a list of realized trade",
    "P&Ls. Returns mean, stddev, skewness, excess-kurtosis, and a convexity",
    "verdict: 'long_convexity' (right tail heavier — trend-following shape),",
    "'short_convexity' (left tail heavier — mean-reversion / blow-up shape),",
    "'symmetric', or 'insufficient_data' (< 10 trades).",
    "",
    "Use during /weekend-review to diagnose whether your realized P&L",
    "distribution matches your intended strategy shape. Mean-reversion",
    "operators expecting symmetric P&L but seeing left-skew should",
    "tighten risk; trend-followers expecting positive skew but seeing",
    "symmetric should re-examine entries/exits.",
  ].join("\n"),
  inputSchema: z.object({
    pnls: z
      .array(z.number())
      .min(1)
      .describe(
        "Array of realized P&L values (USD or % — output is scale-invariant on skew/kurt).",
      ),
  }),
  outputSchema: z.object({
    summary: z.string(),
    count: z.number(),
    mean: z.number(),
    stddev: z.number(),
    skewness: z.number(),
    excessKurtosis: z.number(),
    verdict: z.enum([
      "long_convexity",
      "short_convexity",
      "symmetric",
      "insufficient_data",
    ]),
    min: z.number(),
    max: z.number(),
  }),
  execute: async ({ pnls }: { pnls: number[] }) => {
    const shape = computePnlDistributionShape(pnls);
    return {
      summary: summarizePnlDistributionShape(shape),
      ...shape,
    };
  },
});

// ============================================================================
// get_vol_forecast_calibration
// ============================================================================

export const getVolForecastCalibrationTool = createTool({
  id: "get_vol_forecast_calibration",
  description: [
    "Query the volatility-forecast calibration store for bias/MAE/RMSE/R²",
    "over a window. Spot-market analog of 'is my implied vol systematically",
    "off?' — but applied to Gordon's own internal vol forecasts.",
    "",
    "Returns whether Gordon over-forecasts, under-forecasts, or is near-",
    "unbiased on average. Useful diagnostic for risk classifier tuning and",
    "regime-detector accuracy. Filter by source (which Gordon subsystem",
    "produced the forecast), horizon, or symbol.",
    "",
    "Default window: last 30 days.",
  ].join("\n"),
  inputSchema: z.object({
    startTime: z.string().optional().describe("ISO timestamp. Default: 30 days ago."),
    endTime: z.string().optional().describe("ISO timestamp. Default: now."),
    source: z
      .enum([
        "risk_classifier",
        "regime_detector",
        "atr_projection",
        "strategy_slot_sizing",
        "manual",
        "custom",
      ])
      .optional()
      .describe("Filter to one forecast source."),
    horizon: z
      .enum(["1h", "4h", "1d", "1w", "custom"])
      .optional()
      .describe("Filter to one forecast horizon."),
    symbol: z.string().optional().describe("Filter to one symbol."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    pairCount: z.number(),
    bias: z.number(),
    mae: z.number(),
    rmse: z.number(),
    rSquared: z.number(),
    meanRealized: z.number(),
    windowStart: z.string(),
    windowEnd: z.string(),
  }),
  execute: async ({
    startTime,
    endTime,
    source,
    horizon,
    symbol,
  }: {
    startTime?: string;
    endTime?: string;
    source?:
      | "risk_classifier"
      | "regime_detector"
      | "atr_projection"
      | "strategy_slot_sizing"
      | "manual"
      | "custom";
    horizon?: "1h" | "4h" | "1d" | "1w" | "custom";
    symbol?: string;
  }) => {
    const metrics = getVolCalibration({
      startTime,
      endTime,
      source,
      horizon,
      symbol,
    });
    return {
      summary: summarizeVolCalibration(metrics),
      ...metrics,
    };
  },
});

// ============================================================================
// detect_correlation_breakdown
// ============================================================================

export const detectCorrelationBreakdownTool = createTool({
  id: "detect_correlation_breakdown",
  description: [
    "Detect cross-symbol correlation breakdowns. Caller supplies aligned",
    "log-return series for two or more symbols; the detector computes the",
    "pairwise Pearson correlation in a tail window vs a baseline window,",
    "standardizes the deviation against historical rolling-correlation",
    "variability, and classifies each pair into severity tiers (stable /",
    "elevated / breakdown / regime_shift).",
    "",
    "Use cases: BTC-ETH decoupling, BTC vs altcoin-basket regime shifts,",
    "DeFi-vs-L1 narrative rotation. Spot-market analog of dispersion-",
    "trading signal detection (without the options instrument).",
    "",
    "Caller MUST supply ALIGNED return series — same length, same time",
    "alignment. The detector will throw on misaligned inputs rather than",
    "silently truncate.",
  ].join("\n"),
  inputSchema: z.object({
    series: z
      .array(
        z.object({
          symbol: z.string().min(1),
          returns: z
            .array(z.number())
            .min(2)
            .describe("Log-return series, oldest → newest."),
        }),
      )
      .min(2)
      .describe("At least two symbol/returns pairs to compare."),
    tailWindow: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Trailing observations for current correlation. Default 24."),
    baselineWindow: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Trailing observations for baseline correlation. Default 168."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    tailWindow: z.number(),
    baselineWindow: z.number(),
    observationCount: z.number(),
    flaggedCount: z.number(),
    pairs: z.array(
      z.object({
        symbolA: z.string(),
        symbolB: z.string(),
        currentCorr: z.number(),
        baselineCorr: z.number(),
        delta: z.number(),
        zScore: z.number().nullable(),
        severity: z.enum(["stable", "elevated", "breakdown", "regime_shift"]),
      }),
    ),
  }),
  execute: async ({
    series,
    tailWindow,
    baselineWindow,
  }: {
    series: ReturnSeries[];
    tailWindow?: number;
    baselineWindow?: number;
  }) => {
    try {
      const report = detectCorrelationBreakdown(series, {
        tailWindow,
        baselineWindow,
      });
      return {
        summary: summarizeBreakdownReport(report),
        ...report,
      };
    } catch (err) {
      // Surface the misalignment error in a structured way rather
      // than throwing — keeps agent flow linear.
      return {
        summary: `Correlation breakdown failed: ${err instanceof Error ? err.message : String(err)}`,
        tailWindow: tailWindow ?? 24,
        baselineWindow: baselineWindow ?? 168,
        observationCount: 0,
        flaggedCount: 0,
        pairs: [],
      };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const diagnosticTools = {
  get_pnl_distribution_shape: getPnlDistributionShapeTool,
  get_vol_forecast_calibration: getVolForecastCalibrationTool,
  detect_correlation_breakdown: detectCorrelationBreakdownTool,
};
