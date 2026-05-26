/**
 * Market-Microstructure Diagnostic Tools.
 *
 *   - `compute_microprice` — Stoikov 2017 fair-price estimator. Takes
 *     a recent book history, returns the microprice for the most
 *     recent snapshot + transition diagnostics.
 *
 *   - `compute_inventory_adjusted_price` — Avellaneda-Stoikov
 *     reservation-price formula repurposed as an inventory-bias
 *     adjustment Gordon can consult during entry sizing.
 *
 * Both are pure READ tools — no state mutation, no order placement.
 * Surfaced to Gordon (orchestrator) and Researcher (read-only research
 * agent). Executor doesn't get them by default — these are analytical
 * primitives, not execution helpers.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  computeMicroprice,
  summarizeMicroprice,
  type BookSnapshot,
} from "../../../../core/alpha/microprice.ts";
import {
  computeInventoryAdjustedPrice,
  inventoryAwareSizeMultiplier,
  summarizeInventoryAdjustment,
} from "../../../trading/risk/inventoryAdjustedPrice.ts";
import { monteCarloPath, summarizeMonteCarloPath } from "../../../../core/alpha/monteCarloPath.ts";
import { kellySize } from "../../../../core/alpha/kellySize.ts";

// ============================================================================
// compute_microprice
// ============================================================================

export const computeMicropriceTool = createTool({
  id: "compute_microprice",
  description: [
    "Compute the Stoikov microprice estimator for the most-recent order-book",
    "snapshot. Microprice is a fair-price estimator that corrects mid-price",
    "blind spots — it conditions on the current (imbalance, spread) state",
    "and returns the expected mid-price ~6 quote changes ahead.",
    "",
    "INPUT: a list of book snapshots sorted oldest → newest. The last snapshot",
    "is the current book; the rest is the history used to estimate transition",
    "probabilities. Typical inputs: 1-2 hours of book updates at sub-second",
    "intervals (more is better — sparse states will return reliable=false).",
    "",
    "OUTPUT: microprice estimate, adjustment vs mid, state details, and a",
    "reliability flag. When `reliable` is false the microprice falls back to",
    "mid; the caller should treat it as 'no signal' rather than acting on a",
    "0 adjustment as if it were meaningful.",
    "",
    "Honest caveat: the original Stanford writeup reports the microprice was",
    "'insightful but failed to make significant profit as a standalone signal'.",
    "Treat this as a building block — useful as input to other signals and",
    "anomaly detection, not as a strategy by itself.",
  ].join("\n"),
  inputSchema: z.object({
    snapshots: z
      .array(
        z.object({
          mid: z.number(),
          bid: z.number(),
          ask: z.number(),
          bidVolume: z.number().nonnegative(),
          askVolume: z.number().nonnegative(),
          timestamp: z.number(),
        }),
      )
      .min(1)
      .describe("Book snapshots sorted oldest → newest. ≥100 for reliable estimates."),
    tickSize: z
      .number()
      .positive()
      .describe(
        "Tick size for the instrument (e.g. 0.01 for most equities, 0.5 for some futures). Required.",
      ),
    imbalanceBuckets: z
      .number()
      .int()
      .min(2)
      .max(50)
      .optional()
      .describe("Discretization granularity for imbalance. Default 10."),
    maxSpreadTicks: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Maximum distinct spread tiers in ticks. Default 3."),
    iterations: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Recursion depth. Default 6 (paper convergence point)."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    mid: z.number(),
    microprice: z.number(),
    adjustment: z.number(),
    state: z.number(),
    imbalanceBucket: z.number(),
    spreadBucket: z.number(),
    perIteration: z.array(z.number()),
    transitionsObserved: z.number(),
    reliable: z.boolean(),
  }),
  execute: async ({
    snapshots,
    tickSize,
    imbalanceBuckets,
    maxSpreadTicks,
    iterations,
  }: {
    snapshots: BookSnapshot[];
    tickSize: number;
    imbalanceBuckets?: number;
    maxSpreadTicks?: number;
    iterations?: number;
  }) => {
    const result = computeMicroprice(snapshots, {
      tickSize,
      imbalanceBuckets,
      maxSpreadTicks,
      iterations,
    });
    return {
      summary: summarizeMicroprice(result),
      ...result,
    };
  },
});

// ============================================================================
// compute_inventory_adjusted_price
// ============================================================================

export const computeInventoryAdjustedPriceTool = createTool({
  id: "compute_inventory_adjusted_price",
  description: [
    "Compute the inventory-adjusted reference price using the Avellaneda-Stoikov",
    "reservation formula: r = s - q·γ·σ²·(T-t).",
    "",
    "When Gordon holds a large position, the 'fair value' for additional sizing",
    "should be biased AWAY from mid in the direction that reduces exposure:",
    "  - Long inventory → r below mid → next entry sized smaller, exit sized larger.",
    "  - Short inventory → r above mid → next entry (short) sized smaller, cover larger.",
    "",
    "Use during entry sizing decisions when there's already meaningful inventory.",
    "Returns the adjusted price + a bias label + an audit-friendly summary. Also",
    "returns a size multiplier (0.5-1.0) the caller can apply to a base position",
    "size — values < 1.0 indicate the new trade adds to existing inventory and",
    "should be scaled down.",
    "",
    "Pure compute. The output is a directional bias, not a hard fair value —",
    "treat it as input to sizing, not as a stop or take-profit level.",
  ].join("\n"),
  inputSchema: z.object({
    mid: z.number().positive().describe("Current mid price."),
    inventory: z
      .number()
      .describe(
        "Signed inventory. Positive=long, negative=short. For Gordon, fraction-of-portfolio (-1..+1) is the cleanest unit.",
      ),
    volatility: z
      .number()
      .positive()
      .describe("Per-unit-time volatility (decimal, e.g. 0.02 for 2%)."),
    horizon: z
      .number()
      .positive()
      .describe("Time horizon (T − t) in the same units as volatility."),
    riskAversion: z
      .number()
      .positive()
      .optional()
      .describe(
        "γ parameter. Paper range 0.1-0.5. Higher = more inventory-averse but lower headline P&L. Default 0.1.",
      ),
    intendedSide: z
      .number()
      .optional()
      .describe(
        "Optional. +1 for a buy decision, -1 for a sell. When supplied, the response includes a size multiplier (≤1) that scales down the trade if it would add to existing inventory.",
      ),
  }),
  outputSchema: z.object({
    summary: z.string(),
    adjustedPrice: z.number(),
    adjustment: z.number(),
    adjustmentPct: z.number(),
    bias: z.enum([
      "long_inventory_sell_bias",
      "short_inventory_buy_bias",
      "neutral",
    ]),
    sizeMultiplier: z.number().optional(),
    inputs: z.object({
      mid: z.number(),
      inventory: z.number(),
      volatility: z.number(),
      horizon: z.number(),
      riskAversion: z.number(),
    }),
  }),
  execute: async ({
    mid,
    inventory,
    volatility,
    horizon,
    riskAversion,
    intendedSide,
  }: {
    mid: number;
    inventory: number;
    volatility: number;
    horizon: number;
    riskAversion?: number;
    intendedSide?: number;
  }) => {
    const result = computeInventoryAdjustedPrice({
      mid,
      inventory,
      volatility,
      horizon,
      riskAversion,
    });
    let sizeMultiplier: number | undefined;
    if (intendedSide !== undefined && intendedSide !== 0) {
      sizeMultiplier = inventoryAwareSizeMultiplier(
        inventory,
        intendedSide,
        result.adjustmentPct,
      );
    }
    return {
      summary: summarizeInventoryAdjustment(result),
      adjustedPrice: result.adjustedPrice,
      adjustment: result.adjustment,
      adjustmentPct: result.adjustmentPct,
      bias: result.bias,
      ...(sizeMultiplier !== undefined && { sizeMultiplier }),
      inputs: result.inputs,
    };
  },
});

// ============================================================================
// compute_monte_carlo_path
// ============================================================================

export const computeMonteCarloPathTool = createTool({
  id: "compute_monte_carlo_path",
  description: [
    "Simulate N forward price paths from a recent price series and return",
    "the terminal-price distribution + exceedance probabilities. Two model",
    "modes: 'markov' (state-conditional returns from observed transitions —",
    "captures regime persistence) and 'gbm' (Gaussian iid log returns —",
    "memoryless baseline).",
    "",
    "Use for scenario analysis ('what's P(BTC > 80k in 30 bars)?'),",
    "for Kelly inputs (winProbability via exceedance), and to size around",
    "calibrated terminal distributions instead of point forecasts.",
    "",
    "Honest caveats: Markov on returns assumes the next-return distribution",
    "depends only on the current return bucket — violated during regime",
    "shifts. GBM understates crypto tail risk (log-normal isn't fat enough).",
    "Treat as a sizing aid, not a forecast.",
  ].join("\n"),
  inputSchema: z.object({
    prices: z.array(z.number()).min(2).describe("Price history, oldest → newest. ≥ 60 points recommended."),
    horizonBars: z.number().int().min(1).max(2000).describe("Bars to project forward."),
    nSims: z.number().int().min(100).max(100_000).optional().describe("Default 10000."),
    model: z.enum(["markov", "gbm"]).optional().describe("Default 'markov'."),
    nStates: z.number().int().min(2).max(50).optional().describe("Return-discretization buckets for Markov. Default 10."),
    exceedanceLevels: z.array(z.number()).optional().describe("Prices for P(terminal ≥ level) reporting."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    model: z.enum(["markov", "gbm"]),
    startPrice: z.number(),
    horizonBars: z.number(),
    nSims: z.number(),
    meanTerminal: z.number(),
    stddevTerminal: z.number(),
    quantiles: z.object({
      p05: z.number(),
      p25: z.number(),
      p50: z.number(),
      p75: z.number(),
      p95: z.number(),
    }),
    exceedance: z.array(
      z.object({ level: z.number(), probability: z.number() }),
    ),
    metadata: z.object({
      fittedMu: z.number(),
      fittedSigma: z.number(),
      reliability: z.enum(["low", "medium", "high"]),
    }),
  }),
  execute: async (input) => {
    const result = monteCarloPath(input);
    return { summary: summarizeMonteCarloPath(result), ...result };
  },
});

// ============================================================================
// compute_kelly_size
// ============================================================================

export const computeKellySizeTool = createTool({
  id: "compute_kelly_size",
  description: [
    "Fractional Kelly position sizing. Two modes:",
    "",
    "  'rr' (default, for trade plans): payoutRatio = win/loss R-multiple.",
    "       e.g. 2.0 means target wins 2R, stop loses 1R.",
    "",
    "  'binary' (prediction-market style): payoutRatio = (1 − price) / price.",
    "       For a contract at 42¢ paying $1: b = 0.58/0.42 ≈ 1.38.",
    "",
    "Default multiplier is 0.25 (quarter-Kelly) — the professional standard.",
    "Full Kelly maximizes long-run growth on paper but its finite-sample",
    "drawdowns are punishing and a single bad p estimate is catastrophic.",
    "",
    "Returns recommended dollar size, full-Kelly fraction, edge in bps,",
    "and a verdict label. Does NOT enforce concentration caps — downstream",
    "risk-gate may reduce further.",
  ].join("\n"),
  inputSchema: z.object({
    winProbability: z.number().min(0).max(1),
    bankrollUsd: z.number().positive(),
    payoutRatio: z.number().positive(),
    mode: z.enum(["binary", "rr"]).optional(),
    fractionMultiplier: z.number().min(0).max(1).optional().describe("Default 0.25 (quarter-Kelly)."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    fullKellyFraction: z.number(),
    recommendedFraction: z.number(),
    positionUsd: z.number(),
    edgeBps: z.number(),
    verdict: z.enum(["skip", "small", "normal", "large", "all-in"]),
  }),
  execute: async (input) => kellySize(input),
});

// ============================================================================
// Export
// ============================================================================

export const microstructureTools = {
  compute_microprice: computeMicropriceTool,
  compute_inventory_adjusted_price: computeInventoryAdjustedPriceTool,
  compute_monte_carlo_path: computeMonteCarloPathTool,
  compute_kelly_size: computeKellySizeTool,
};
