/**
 * Efficiency Ratio Diagnostic Tool — exposed via /efficiency-ratio.
 *
 * Wraps `computeEfficiencyRatio` (TS1) for operator inspection.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeEfficiencyRatio,
  efficiencyRatioToPayload,
} from "../../../trading/quant/efficiencyRatio.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const efficiencyRatioDiagnosticTool = createTool({
  id: "compute_efficiency_ratio",
  description:
    "Compute Kaufman's efficiency ratio (net price change / total path length) over a window. " +
    "Use when the operator asks `/efficiency-ratio`, or when classifying a market window as trending vs choppy. " +
    "Returns ER in [0, 1] plus a regime classification (trending / mixed / choppy).",
  inputSchema: z.object({
    prices: z.array(z.number()).min(2).describe("Price series (newest last)."),
    period: z.number().int().positive().default(10).describe("Lookback period. Default 10."),
    trendingThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.3)
      .describe("ER ≥ this → trending. Default 0.3."),
    choppyThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.1)
      .describe("ER < this → choppy. Default 0.1."),
  }),
  outputSchema: z.object({
    efficiencyRatio: z.number(),
    regime: z.enum(["choppy", "mixed", "trending"]),
    netChange: z.number(),
    pathLength: z.number(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeEfficiencyRatio({
      prices: input.prices,
      period: input.period,
      trendingThreshold: input.trendingThreshold,
      choppyThreshold: input.choppyThreshold,
    });
    const summary = `ER ${result.efficiencyRatio.toFixed(3)} → ${result.regime}. ${result.reasoning}`;
    recordStructuredObservation({
      eventType: "efficiency_ratio.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_efficiency_ratio",
      toolName: "compute_efficiency_ratio",
      outcome: "info",
      details: { ...(efficiencyRatioToPayload(result) as Record<string, unknown>) },
    });
    return {
      efficiencyRatio: Number(result.efficiencyRatio.toFixed(5)),
      regime: result.regime,
      netChange: Number(result.netChange.toFixed(5)),
      pathLength: Number(result.pathLength.toFixed(5)),
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const efficiencyRatioTools = { compute_efficiency_ratio: efficiencyRatioDiagnosticTool };
