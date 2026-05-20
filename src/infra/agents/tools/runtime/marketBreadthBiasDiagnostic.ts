/**
 * Market Breadth Directional Bias Diagnostic Tool — TM3 wrapper.
 *
 * Agent-callable. Pre-plan context check: takes a basket of recent
 * returns across the trading universe and returns bullish / bearish /
 * balanced classification + the breadth statistics that drove it.
 *
 * Operator pattern: balanced day → only high-quality setups in either
 * direction; bullish day → can take lower-quality longs but extra
 * filter on shorts (symmetric for bearish).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeMarketBreadthBias,
  marketBreadthBiasToPayload,
} from "../../../trading/quant/marketBreadthBias.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const marketBreadthBiasDiagnosticTool = createTool({
  id: "compute_market_breadth_bias",
  description:
    "Compute the directional bias of a universe of symbols from their recent returns. Classifies the market as " +
    "bullish, bearish, or balanced based on the fraction of positive vs negative returns. " +
    "Use as a pre-plan context check: bullish day → can relax long-quality filters, tighten short filters " +
    "(symmetric for bearish); balanced day → standard quality filters in both directions.",
  inputSchema: z.object({
    returns: z
      .array(z.number())
      .min(1)
      .describe("Recent returns, one per symbol in the universe (e.g., 24h fractional returns)."),
    bullishThreshold: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe("Min fraction of returns positive to call market bullish. Default 0.70."),
    bearishThreshold: z
      .number()
      .gt(0)
      .max(1)
      .optional()
      .describe("Min fraction of returns negative to call market bearish. Default 0.70."),
    flatThreshold: z
      .number()
      .min(0)
      .optional()
      .describe("Returns with |r| ≤ this magnitude count as flat. Default 0."),
  }),
  outputSchema: z.object({
    bias: z.enum(["bullish", "bearish", "balanced"]),
    total: z.number(),
    positiveCount: z.number(),
    negativeCount: z.number(),
    flatCount: z.number(),
    positiveFraction: z.number(),
    negativeFraction: z.number(),
    meanReturn: z.number(),
    medianReturn: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeMarketBreadthBias({
      returns: input.returns,
      bullishThreshold: input.bullishThreshold,
      bearishThreshold: input.bearishThreshold,
      flatThreshold: input.flatThreshold,
    });
    recordStructuredObservation({
      eventType: "market_breadth_bias.requested",
      workflow: "market_scan",
      source: "agent_tool",
      component: "compute_market_breadth_bias",
      toolName: "compute_market_breadth_bias",
      outcome: "info",
      details: { ...(marketBreadthBiasToPayload(result) as Record<string, unknown>) },
    });
    return {
      bias: result.bias,
      total: result.total,
      positiveCount: result.positiveCount,
      negativeCount: result.negativeCount,
      flatCount: result.flatCount,
      positiveFraction: Number(result.positiveFraction.toFixed(4)),
      negativeFraction: Number(result.negativeFraction.toFixed(4)),
      meanReturn: Number(result.meanReturn.toFixed(6)),
      medianReturn: Number(result.medianReturn.toFixed(6)),
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const marketBreadthBiasTools = {
  compute_market_breadth_bias: marketBreadthBiasDiagnosticTool,
};
