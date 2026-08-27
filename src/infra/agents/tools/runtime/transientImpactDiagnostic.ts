/**
 * Transient Impact Diagnostic Tool — CJ2 wrapper.
 *
 * Agent-callable. Given a fill history and an Obizhaeva-Wang
 * half-life, returns the residual price impact at "now". Used during
 * post-trade review (how much of the move was our impact vs market
 * drift?) or pre-trade (if I send N more shares, how much residual
 * impact am I still carrying?).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeTransientImpact,
  transientImpactToPayload,
} from "../../../trading/quant/transientImpact.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const transientImpactDiagnosticTool = createTool({
  id: "compute_transient_impact",
  description:
    "Compute the residual transient + permanent market impact at the current time, given a history of fills " +
    "and an Obizhaeva-Wang exponential decay half-life. " +
    "Use during post-trade review to attribute price moves to your own footprint vs market drift, " +
    "or pre-trade to see how much residual impact you're already carrying.",
  inputSchema: z.object({
    now: z.number().describe("Current timestamp (any consistent unit — must be ≥ all fill times)."),
    fills: z
      .array(
        z.object({
          time: z.number().describe("Time of the fill (same units as `now`)."),
          signedSize: z.number().describe("Signed size: positive = BUY, negative = SELL."),
        }),
      )
      .describe("Fill history."),
    halfLife: z
      .number()
      .positive()
      .describe("Exponential decay half-life (same units as `now`). Tune per venue/symbol."),
    transientCoef: z
      .number()
      .min(0)
      .optional()
      .describe("Per-share transient-impact coefficient (price units per share). Default 1."),
    permanentCoef: z
      .number()
      .min(0)
      .optional()
      .describe("Per-share permanent-impact coefficient (price units per share). Default 0."),
  }),
  outputSchema: z.object({
    totalImpact: z.number(),
    transientImpact: z.number(),
    permanentImpact: z.number(),
    decayRate: z.number(),
    effectiveFillCount: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeTransientImpact({
      now: input.now,
      fills: input.fills,
      halfLife: input.halfLife,
      transientCoef: input.transientCoef,
      permanentCoef: input.permanentCoef,
    });
    recordStructuredObservation({
      eventType: "transient_impact.requested",
      workflow: "post_trade_review",
      source: "agent_tool",
      component: "compute_transient_impact",
      toolName: "compute_transient_impact",
      outcome: "info",
      details: { ...(transientImpactToPayload(result) as Record<string, unknown>) },
    });
    return {
      totalImpact: Number(result.totalImpact.toFixed(6)),
      transientImpact: Number(result.transientImpact.toFixed(6)),
      permanentImpact: Number(result.permanentImpact.toFixed(6)),
      decayRate: Number(result.decayRate.toFixed(6)),
      effectiveFillCount: result.effectiveFillCount,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const transientImpactTools = {
  compute_transient_impact: transientImpactDiagnosticTool,
};
