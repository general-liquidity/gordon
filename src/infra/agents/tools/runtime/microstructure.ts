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
// Export
// ============================================================================

export const microstructureTools = {
  compute_microprice: computeMicropriceTool,
  compute_inventory_adjusted_price: computeInventoryAdjustedPriceTool,
};
