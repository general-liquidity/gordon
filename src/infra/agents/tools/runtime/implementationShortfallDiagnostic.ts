/**
 * Implementation Shortfall Diagnostic Tool — agent-callable Perold/Wagner
 * four-bucket decomposition. Designed for post-trade review: the agent
 * resolves trade-history breadcrumbs (decision price, arrival price,
 * VWAP of fills, close price, quantities, fees) and calls this tool to
 * tell the operator *where the edge leaked*.
 *
 * Not exposed as a slash command — the natural invocation is
 * conversational ("review my last trade", "where did my edge go on
 * that BTC exit"). The agent looks up the trade context and invokes
 * this internally.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeImplementationShortfall,
  implementationShortfallToPayload,
} from "../../../trading/quant/implementationShortfall.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const implementationShortfallDiagnosticTool = createTool({
  id: "compute_implementation_shortfall",
  description:
    "Decompose a completed trade into Perold-Wagner Implementation Shortfall buckets: delay, market impact, opportunity, fees. " +
    "Use when reviewing a closed trade to identify where the edge leaked. " +
    "Inputs are price checkpoints; outputs are bucket costs in both account currency and bps, plus dominant-bucket classification.",
  inputSchema: z.object({
    decisionPrice: z.number().positive().describe("Price at the moment the trading decision was made."),
    arrivalPrice: z
      .number()
      .positive()
      .describe("Price when the order first hit the market (set equal to decisionPrice if you don't track this separately — collapses the delay bucket)."),
    avgFillPrice: z.number().positive().describe("Volume-weighted average price across all fills."),
    closePrice: z
      .number()
      .positive()
      .describe("Reference price for the unexecuted residual — typically the close of the active day or the cancellation price."),
    decisionQuantity: z.number().positive().describe("Quantity the operator decided to trade."),
    filledQuantity: z.number().min(0).describe("Quantity actually filled. Must satisfy 0 ≤ filledQty ≤ decisionQty."),
    side: z.enum(["BUY", "SELL"]).describe("Order side."),
    fees: z.number().min(0).optional().describe("Explicit fees in account currency. Default 0."),
  }),
  outputSchema: z.object({
    totalCost: z.number(),
    totalCostBps: z.number(),
    delayCost: z.number(),
    delayCostBps: z.number(),
    marketImpactCost: z.number(),
    marketImpactCostBps: z.number(),
    opportunityCost: z.number(),
    opportunityCostBps: z.number(),
    feesCost: z.number(),
    feesCostBps: z.number(),
    fillRate: z.number(),
    dominantBucket: z.enum(["delay", "impact", "opportunity", "fees", "none"]),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeImplementationShortfall({
      decisionPrice: input.decisionPrice,
      arrivalPrice: input.arrivalPrice,
      avgFillPrice: input.avgFillPrice,
      closePrice: input.closePrice,
      decisionQuantity: input.decisionQuantity,
      filledQuantity: input.filledQuantity,
      side: input.side,
      fees: input.fees,
    });
    recordStructuredObservation({
      eventType: "implementation_shortfall.requested",
      workflow: "post_trade_review",
      source: "agent_tool",
      component: "compute_implementation_shortfall",
      toolName: "compute_implementation_shortfall",
      outcome: "info",
      details: { ...(implementationShortfallToPayload(result) as Record<string, unknown>) },
    });
    return {
      totalCost: Number(result.totalCost.toFixed(4)),
      totalCostBps: Number(result.totalCostBps.toFixed(2)),
      delayCost: Number(result.delayCost.toFixed(4)),
      delayCostBps: Number(result.delayCostBps.toFixed(2)),
      marketImpactCost: Number(result.marketImpactCost.toFixed(4)),
      marketImpactCostBps: Number(result.marketImpactCostBps.toFixed(2)),
      opportunityCost: Number(result.opportunityCost.toFixed(4)),
      opportunityCostBps: Number(result.opportunityCostBps.toFixed(2)),
      feesCost: Number(result.fees.toFixed(4)),
      feesCostBps: Number(result.feesBps.toFixed(2)),
      fillRate: Number(result.fillRate.toFixed(4)),
      dominantBucket: result.dominantBucket,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const implementationShortfallTools = {
  compute_implementation_shortfall: implementationShortfallDiagnosticTool,
};
