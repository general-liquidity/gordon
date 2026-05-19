/**
 * Optimal Limit-Order Depth Diagnostic Tool — CJ3 wrapper.
 *
 * Agent-callable. Given an exponential fill-intensity model and a
 * terminal inventory penalty, returns the closed-form optimal depth
 * at which to post a limit order. Used when the agent wants to choose
 * a posting depth analytically instead of heuristically.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeOptimalLimitDepth,
  optimalLimitDepthToPayload,
} from "../../../trading/quant/optimalLimitDepth.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const optimalLimitDepthDiagnosticTool = createTool({
  id: "compute_optimal_limit_depth",
  description:
    "Compute the Cartea-Jaimungal optimal posting depth δ*(t, q) for a limit-order execution problem with " +
    "exponential fill intensity λ(δ) = A·exp(-κ·δ) and terminal inventory penalty α. " +
    "Returns the depth that balances fill probability against per-fill profit. " +
    "Use when the agent needs to choose limit-order depth analytically instead of heuristically.",
  inputSchema: z.object({
    timeRemaining: z
      .number()
      .positive()
      .describe("Time remaining in the execution horizon."),
    inventoryRemaining: z
      .number()
      .int()
      .min(1)
      .describe("Inventory units remaining (integer ≥ 1)."),
    intensityScale: z
      .number()
      .positive()
      .describe("Fill-intensity scale A (fills per unit time at depth=0)."),
    intensityDecay: z
      .number()
      .positive()
      .describe("Fill-intensity decay rate κ (depth-sensitivity of arrivals)."),
    terminalPenalty: z
      .number()
      .min(0)
      .optional()
      .describe("Terminal inventory penalty α. Higher = more urgent. Default 0.1."),
  }),
  outputSchema: z.object({
    optimalDepth: z.number(),
    fillIntensityAtOptimal: z.number(),
    lambdaRatio: z.number(),
    psiRatio: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeOptimalLimitDepth({
      timeRemaining: input.timeRemaining,
      inventoryRemaining: input.inventoryRemaining,
      intensityScale: input.intensityScale,
      intensityDecay: input.intensityDecay,
      terminalPenalty: input.terminalPenalty,
    });
    recordStructuredObservation({
      eventType: "optimal_limit_depth.requested",
      workflow: "execution_planning",
      source: "agent_tool",
      component: "compute_optimal_limit_depth",
      toolName: "compute_optimal_limit_depth",
      outcome: "info",
      details: { ...(optimalLimitDepthToPayload(result) as Record<string, unknown>) },
    });
    return {
      optimalDepth: Number(result.optimalDepth.toFixed(6)),
      fillIntensityAtOptimal: Number(result.fillIntensityAtOptimal.toFixed(6)),
      lambdaRatio: Number(result.lambdaRatio.toFixed(6)),
      psiRatio: Number(result.psiRatio.toFixed(6)),
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const optimalLimitDepthTools = {
  compute_optimal_limit_depth: optimalLimitDepthDiagnosticTool,
};
