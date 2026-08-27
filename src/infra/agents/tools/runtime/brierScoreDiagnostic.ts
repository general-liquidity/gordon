/**
 * Brier Score Diagnostic Tool — calibration-metric wrapper.
 *
 * Agent-callable. Given a series of probability predictions and their
 * binary outcomes, returns the Brier score + skill score + calibration
 * classification. Use to evaluate whether any probability-emitting
 * component is well-calibrated (regime detector transition probabilities,
 * signal classifiers, future probabilistic outputs).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeBrierScore, brierScoreToPayload } from "../../../trading/quant/brierScore.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const brierScoreDiagnosticTool = createTool({
  id: "compute_brier_score",
  description:
    "Compute the Brier score (calibration metric) for a series of probability predictions vs binary outcomes. " +
    "Returns the score plus a skill score (vs baseline = sample mean of outcomes by default) and a calibration " +
    "classification (excellent < 0.10, good < 0.20, marginal < 0.25, poor ≥ 0.25). " +
    "Reference: 538 / Economist hit 0.06–0.12 on presidential races. Use to track calibration drift in any " +
    "probability-emitting component over time.",
  inputSchema: z.object({
    predictions: z
      .array(z.number().min(0).max(1))
      .min(1)
      .describe("Predicted probabilities, each in [0, 1]."),
    outcomes: z
      .array(z.union([z.number(), z.boolean()]))
      .min(1)
      .describe("Binary outcomes: 0/1 or true/false. Must have same length as predictions."),
    baselineProbability: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Baseline probability for skill-score reference. Default = sample mean of outcomes (climatology).",
      ),
  }),
  outputSchema: z.object({
    brierScore: z.number(),
    baselineBrier: z.number(),
    skillScore: z.number(),
    classification: z.enum(["excellent", "good", "marginal", "poor"]),
    baseRate: z.number(),
    baselineProbability: z.number(),
    nPredictions: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeBrierScore({
      predictions: input.predictions,
      outcomes: input.outcomes,
      baselineProbability: input.baselineProbability,
    });
    recordStructuredObservation({
      eventType: "brier_score.computed",
      workflow: "calibration",
      source: "agent_tool",
      component: "compute_brier_score",
      toolName: "compute_brier_score",
      outcome: "info",
      details: { ...(brierScoreToPayload(result) as Record<string, unknown>) },
    });
    return {
      brierScore: Number(result.brierScore.toFixed(6)),
      baselineBrier: Number(result.baselineBrier.toFixed(6)),
      skillScore: Number(result.skillScore.toFixed(6)),
      classification: result.classification,
      baseRate: Number(result.baseRate.toFixed(6)),
      baselineProbability: Number(result.baselineProbability.toFixed(6)),
      nPredictions: result.nPredictions,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const brierScoreTools = {
  compute_brier_score: brierScoreDiagnosticTool,
};
