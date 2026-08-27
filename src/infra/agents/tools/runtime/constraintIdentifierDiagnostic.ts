/**
 * Constraint-Identifier Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `identifyConstraint` from core/alpha/constraint-identifier.ts.
 * Codifies Spicy's Theory-of-Constraints framing — find the SINGLE
 * biggest EV-component bottleneck (win rate / avg win / avg loss /
 * frequency) and attack it. Composes with expectancy-by-tag: feed
 * its overall row's stats + operator-declared targets in.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { identifyConstraint } from "../../../../core/alpha/constraint-identifier.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const constraintIdentifierDiagnosticTool = createTool({
  id: "identify_constraint",
  description:
    "Identify the dominant EV-component bottleneck across win rate / avg win / avg loss / frequency. " +
    "Pass current values + operator-declared targets per component; returns ranked deficits + the single " +
    "biggest constraint + a recommended improvement lever (Spicy steps 1-7). Use during retrospective " +
    "reviews — answers 'which of the 4 EV variables should I focus on improving next?'.",
  inputSchema: z.object({
    winRate: z.object({
      current: z.number().min(0).max(1).describe("Current win rate as fraction in [0, 1]."),
      target: z.number().min(0).max(1).describe("Target win rate as fraction in [0, 1]."),
    }),
    avgWin: z.object({
      current: z.number().describe("Average winning trade (R-multiple or $)."),
      target: z.number().describe("Target average winning trade."),
    }),
    avgLoss: z.object({
      current: z.number().describe("Average losing trade as POSITIVE magnitude (R-multiple or $)."),
      target: z
        .number()
        .describe("Target average losing trade — also positive magnitude (max acceptable)."),
    }),
    frequency: z.object({
      current: z.number().min(0).describe("Current trade frequency (e.g. trades per week)."),
      target: z.number().min(0).describe("Target trade frequency."),
    }),
    sampleSize: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Optional sample size for confidence weighting."),
    minSampleSize: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Minimum sample for confident verdict. Default 30."),
  }),
  outputSchema: z.object({
    verdict: z.enum(["no_constraint", "constraint_identified", "insufficient_data"]),
    dominantComponent: z.enum(["win_rate", "avg_win", "avg_loss", "frequency"]).nullable(),
    dominantNormalizedDeficit: z.number().nullable(),
    recommendedLever: z.string().nullable(),
    lowConfidence: z.boolean(),
    rankedComponents: z.array(
      z.object({
        component: z.enum(["win_rate", "avg_win", "avg_loss", "frequency"]),
        current: z.number(),
        target: z.number(),
        normalizedDeficit: z.number(),
        rawGap: z.number(),
        meetsTarget: z.boolean(),
      }),
    ),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = identifyConstraint({
      winRate: input.winRate,
      avgWin: input.avgWin,
      avgLoss: input.avgLoss,
      frequency: input.frequency,
      sampleSize: input.sampleSize,
      minSampleSize: input.minSampleSize,
    });
    recordStructuredObservation({
      eventType: "constraint.identified",
      workflow: "reflection",
      source: "agent_tool",
      component: "identify_constraint",
      toolName: "identify_constraint",
      outcome: "info",
      details: {
        verdict: result.verdict,
        dominantComponent: result.dominantConstraint?.component ?? null,
        dominantDeficit: result.dominantConstraint?.normalizedDeficit ?? null,
        lowConfidence: result.lowConfidence,
      },
    });
    return {
      verdict: result.verdict,
      dominantComponent: result.dominantConstraint?.component ?? null,
      dominantNormalizedDeficit: result.dominantConstraint?.normalizedDeficit ?? null,
      recommendedLever: result.dominantConstraint?.recommendedLever ?? null,
      lowConfidence: result.lowConfidence,
      rankedComponents: result.rankedByDeficit.map((c) => ({
        component: c.component,
        current: c.current,
        target: c.target,
        normalizedDeficit: c.normalizedDeficit,
        rawGap: c.rawGap,
        meetsTarget: c.meetsTarget,
      })),
      summary: result.summary,
    };
  },
});

export const constraintIdentifierTools = {
  identify_constraint: constraintIdentifierDiagnosticTool,
};
