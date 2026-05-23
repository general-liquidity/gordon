/**
 * Tail-Conditional Hedge Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `classifyTailConditionalHedges` from
 * core/alpha/tail-conditional-hedge.ts. Matt's "Treasuries are a
 * peace-time hedge" framing operationalized: regime-conditional
 * correlation analysis that distinguishes hedges that hold up in
 * tail events from those that don't.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { classifyTailConditionalHedges } from "../../../../core/alpha/tail-conditional-hedge.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const tailConditionalHedgeDiagnosticTool = createTool({
  id: "classify_tail_conditional_hedges",
  description:
    "Classify N candidate hedges by regime-conditional correlation: peace-time (low target vol) vs " +
    "tail-time (high target vol). Identifies robust hedges (negative in both regimes), peace-time " +
    "hedges (work in calm markets but fail in crisis — Matt's canonical Treasury example), volatile, " +
    "anti-hedges (wrong sign), and insufficient cases. Distinct from effective-n.ts (unconditional " +
    "correlation across whole window) and marginal-contribution.ts (drawdown overlap aggregated).",
  inputSchema: z.object({
    targetReturns: z
      .array(z.number())
      .min(40)
      .describe("Target asset returns aligned oldest → newest."),
    candidateHedges: z
      .array(
        z.object({
          symbol: z.string(),
          returns: z.array(z.number()),
        }),
      )
      .min(1)
      .describe("Candidate hedges; returns must align 1:1 with target."),
    volWindow: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Rolling window for vol-based regime classification. Default 20."),
    tailQuantile: z
      .number()
      .min(0.5)
      .max(1)
      .optional()
      .describe("Vol quantile above which observations are 'tail'. Default 0.90."),
    peaceQuantile: z
      .number()
      .min(0)
      .max(0.9)
      .optional()
      .describe("Vol quantile below which observations are 'peace'. Default 0.50."),
    minObservationsPerRegime: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Min observations per regime for verdict. Default 20."),
    strongCorrThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("|correlation| threshold for 'strong'. Default 0.40."),
    weakCorrThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("|correlation| threshold for 'weak'. Default 0.15."),
  }),
  outputSchema: z.object({
    sampleSize: z.number(),
    peaceObservations: z.number(),
    tailObservations: z.number(),
    hedges: z.array(
      z.object({
        symbol: z.string(),
        peaceTimeCorrelation: z.number().nullable(),
        tailTimeCorrelation: z.number().nullable(),
        unconditionalCorrelation: z.number().nullable(),
        peaceObservations: z.number(),
        tailObservations: z.number(),
        reliability: z.enum([
          "robust",
          "peace_time",
          "fair_weather",
          "volatile",
          "anti_hedge",
          "insufficient",
        ]),
        reason: z.string(),
      }),
    ),
    bestRobustHedge: z.string().nullable(),
    verdict: z.enum(["ranked", "insufficient_data"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = classifyTailConditionalHedges(input);
    recordStructuredObservation({
      eventType: "tail_conditional_hedge.classified",
      workflow: "analysis",
      source: "agent_tool",
      component: "classify_tail_conditional_hedges",
      toolName: "classify_tail_conditional_hedges",
      outcome: result.bestRobustHedge === null ? "failure" : "info",
      details: {
        verdict: result.verdict,
        sampleSize: result.sampleSize,
        robustCount: result.hedges.filter((h) => h.reliability === "robust").length,
        peaceTimeCount: result.hedges.filter((h) => h.reliability === "peace_time").length,
        bestRobustHedge: result.bestRobustHedge,
      },
    });
    return result;
  },
});

export const tailConditionalHedgeTools = {
  classify_tail_conditional_hedges: tailConditionalHedgeDiagnosticTool,
};
