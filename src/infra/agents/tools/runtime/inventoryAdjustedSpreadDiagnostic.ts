/**
 * Inventory-Adjusted Spread Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `computeInventoryAdjustedSpread` from
 * core/alpha/inventory-adjusted-spread.ts. Avellaneda-Stoikov-style
 * two-sided market-making with inventory skew. Distinct from
 * `compute_optimal_limit_depth` (CJ3 single-sided execution depth)
 * and Kelly/wipeout-cap sizers (no per-side quote setpoint).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeInventoryAdjustedSpread } from "../../../../core/alpha/inventory-adjusted-spread.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const inventoryAdjustedSpreadDiagnosticTool = createTool({
  id: "compute_inventory_adjusted_spread",
  description:
    "Avellaneda-Stoikov-style two-sided market-maker quoting. Given current inventory, risk aversion, " +
    "volatility, time horizon, and order-arrival intensity decay, returns the reservation price " +
    "(skewed away from mid by inventory), optimal total spread, and resulting bid/ask quotes. " +
    "Long inventory tightens ask + widens bid; short inventory reverses. Inventory-pull triggers " +
    "when |inventory| exceeds hard limit. Distinct from compute_optimal_limit_depth (CJ3 single-" +
    "sided execution depth) and Kelly/wipeout-cap sizers (no quote setpoint).",
  inputSchema: z.object({
    midPrice: z.number().positive().describe("Current mid price."),
    inventory: z.number().describe("Signed inventory position. Positive = long, negative = short."),
    riskAversion: z.number().positive().optional().describe("γ. Default 0.1."),
    volatility: z.number().min(0).describe("Per-period volatility σ."),
    timeRemaining: z
      .number()
      .positive()
      .describe("Horizon remaining (T − t) in same time units as σ."),
    intensityDecay: z.number().positive().describe("Order-arrival intensity decay k."),
    inventoryHardLimit: z
      .number()
      .positive()
      .optional()
      .describe("Inventory band that triggers single-side pull. Default Infinity."),
  }),
  outputSchema: z.object({
    midPrice: z.number(),
    reservationPrice: z.number(),
    reservationSkew: z.number(),
    totalSpread: z.number(),
    halfSpread: z.number(),
    bidPrice: z.number(),
    askPrice: z.number(),
    bidPulled: z.boolean(),
    askPulled: z.boolean(),
    verdict: z.enum(["two_sided", "long_capped", "short_capped", "invalid_inputs"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeInventoryAdjustedSpread(input);
    recordStructuredObservation({
      eventType: "inventory_adjusted_spread.computed",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_inventory_adjusted_spread",
      toolName: "compute_inventory_adjusted_spread",
      outcome:
        result.verdict === "long_capped" || result.verdict === "short_capped" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        reservationSkew: result.reservationSkew,
        totalSpread: result.totalSpread,
        bidPulled: result.bidPulled,
        askPulled: result.askPulled,
      },
    });
    return result;
  },
});

export const inventoryAdjustedSpreadTools = {
  compute_inventory_adjusted_spread: inventoryAdjustedSpreadDiagnosticTool,
};
