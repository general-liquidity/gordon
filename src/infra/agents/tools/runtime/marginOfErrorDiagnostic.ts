/**
 * Margin-of-Error Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `computeMarginOfError` from core/alpha/margin-of-error.ts.
 * Codifies Spicy's cheat sheet: combine directional bias + structural
 * bias + strategy direction + strategy type → trade-grade verdict
 * with risk multiplier. Agent calls before sizing to dial position
 * up (in-sync environment) or down (out-of-sync), or skip.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeMarginOfError } from "../../../../core/alpha/margin-of-error.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const marginOfErrorDiagnosticTool = createTool({
  id: "compute_margin_of_error",
  description:
    "Combine market biases (directional + structural) with strategy intent (direction + type) " +
    "to produce a trade-grade verdict + risk multiplier. Grade B (fully in-sync) → take aggressively; " +
    "Grade A → take normally; A+ → only take if high quality; C (fully out-of-sync) → skip. " +
    "Use BEFORE sizing — the suggested risk multiplier dials position size by environment fit.",
  inputSchema: z.object({
    directionalBias: z
      .enum(["long_favoring", "short_favoring", "none"])
      .describe("Directional bias on the asset/market (long_favoring / short_favoring / none)."),
    structuralBias: z
      .enum(["trending", "ranging", "none"])
      .describe("Structural bias (trending / ranging / none)."),
    strategyDirection: z.enum(["long", "short"]).describe("Strategy direction (long or short)."),
    strategyType: z
      .enum(["breakout", "mean_reversion"])
      .describe("Strategy type (breakout / mean_reversion)."),
  }),
  outputSchema: z.object({
    directionalInSync: z.boolean(),
    structuralInSync: z.boolean(),
    rawScore: z.number(),
    grade: z.enum(["A+", "A", "B", "C"]),
    recommendation: z.enum([
      "take_aggressively",
      "take_normally",
      "take_only_high_quality",
      "skip",
    ]),
    suggestedRiskMultiplier: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeMarginOfError({
      directionalBias: input.directionalBias,
      structuralBias: input.structuralBias,
      strategyDirection: input.strategyDirection,
      strategyType: input.strategyType,
    });
    recordStructuredObservation({
      eventType: "margin_of_error.computed",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_margin_of_error",
      toolName: "compute_margin_of_error",
      outcome: result.recommendation === "skip" ? "failure" : "info",
      details: {
        grade: result.grade,
        recommendation: result.recommendation,
        rawScore: result.rawScore,
        suggestedRiskMultiplier: result.suggestedRiskMultiplier,
        directionalInSync: result.directionalInSync,
        structuralInSync: result.structuralInSync,
      },
    });
    return {
      directionalInSync: result.directionalInSync,
      structuralInSync: result.structuralInSync,
      rawScore: result.rawScore,
      grade: result.grade,
      recommendation: result.recommendation,
      suggestedRiskMultiplier: result.suggestedRiskMultiplier,
      summary: result.summary,
    };
  },
});

export const marginOfErrorTools = {
  compute_margin_of_error: marginOfErrorDiagnosticTool,
};
