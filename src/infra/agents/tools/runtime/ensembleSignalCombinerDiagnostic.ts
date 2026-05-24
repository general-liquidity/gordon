/**
 * Ensemble Signal Combiner Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `combineEnsembleSignals` from core/alpha/ensemble-signal-combiner.ts.
 * Weighted aggregation of directional signals in [-1, +1] with conviction
 * + agreement diagnostics. Operationalizes López de Prado's weak-learner
 * → strong-learner ensemble pattern. Designed to consume the directional
 * outputs of other Gordon primitives (cross-sectional momentum, FIP
 * quality, aggression-ratio, etc.) and produce one composite signal for
 * continuous position sizing.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { combineEnsembleSignals } from "../../../../core/alpha/ensemble-signal-combiner.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const ensembleSignalCombinerDiagnosticTool = createTool({
  id: "combine_ensemble_signals",
  description:
    "Aggregate N directional signals (each in [-1, +1]) into one composite. Returns compositeScore, " +
    "direction, conviction (= |composite|), agreementFraction (sources matching dominant direction), " +
    "per-source contribution, continuousPositionFraction (= compositeScore for direct sizing input), " +
    "and verdict: strong_long / weak_long / neutral / weak_short / strong_short / disagreement / " +
    "insufficient_data. The 'disagreement' verdict flags fragile ensembles where one big-weight source " +
    "overwhelms many small opposing sources. Distinct from confluenceScorer (categorical tier counting).",
  inputSchema: z.object({
    signals: z
      .array(
        z.object({
          id: z.string(),
          value: z
            .number()
            .describe("Directional signal in [-1, +1]. Out-of-range clipped by default."),
          weight: z
            .number()
            .min(0)
            .optional()
            .describe("Optional non-negative weight. Default 1."),
          description: z.string().optional(),
        }),
      )
      .min(1),
    strongThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("|composite| ≥ this counts as strong. Default 0.6."),
    weakThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("|composite| ≥ this counts as weak (else neutral). Default 0.2."),
    minSources: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Min valid sources for a verdict. Default 2."),
    agreementThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Min agreement fraction (else disagreement). Default 0.6."),
    clipOutOfRange: z
      .boolean()
      .optional()
      .describe("Clip values outside [-1, +1] (default true)."),
  }),
  outputSchema: z.object({
    totalSources: z.number(),
    validSources: z.number(),
    compositeScore: z.number(),
    direction: z.enum(["long", "short", "neutral"]),
    conviction: z.number(),
    agreementFraction: z.number(),
    perSource: z.array(
      z.object({
        id: z.string(),
        value: z.number(),
        weight: z.number(),
        weightedContribution: z.number(),
        agreesWithComposite: z.boolean(),
        description: z.string().optional(),
      }),
    ),
    continuousPositionFraction: z.number(),
    verdict: z.enum([
      "strong_long",
      "weak_long",
      "neutral",
      "weak_short",
      "strong_short",
      "disagreement",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = combineEnsembleSignals(input.signals, {
      strongThreshold: input.strongThreshold,
      weakThreshold: input.weakThreshold,
      minSources: input.minSources,
      agreementThreshold: input.agreementThreshold,
      clipOutOfRange: input.clipOutOfRange,
    });
    recordStructuredObservation({
      eventType: "ensemble_signal.combined",
      workflow: "analysis",
      source: "agent_tool",
      component: "combine_ensemble_signals",
      toolName: "combine_ensemble_signals",
      outcome:
        result.verdict === "insufficient_data" ||
        result.verdict === "disagreement"
          ? "failure"
          : "info",
      details: {
        verdict: result.verdict,
        compositeScore: result.compositeScore,
        conviction: result.conviction,
        agreementFraction: result.agreementFraction,
        validSources: result.validSources,
      },
    });
    return result;
  },
});

export const ensembleSignalCombinerTools = {
  combine_ensemble_signals: ensembleSignalCombinerDiagnosticTool,
};
