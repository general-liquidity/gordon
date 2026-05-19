/**
 * Effective-N Diagnostic Tool — exposed via /effective-n slash command.
 *
 * Wraps `computeEffectiveN` from infra/trading/quant/effectiveN.ts as a
 * Mastra tool. Two input shapes accepted:
 *
 *   1. A pairwise correlation matrix (NxN, symmetric, diagonal = 1) +
 *      optional labels.
 *   2. Raw signal series (signalId + value array) — correlation matrix
 *      computed internally.
 *
 * Produces the participation-ratio effective-N count, redundant-pair
 * report, and a reasoning string. The deck-quality diagnostic for "this
 * chain runs N gates, but the effective independent count is X."
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeEffectiveN,
  effectiveNToPayload,
} from "../../../trading/quant/effectiveN.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const effectiveNDiagnosticTool = createTool({
  id: "compute_effective_n",
  description:
    "Compute the effective number of independent signals from a correlation matrix or set of raw signal series. " +
    "Use when the operator asks `/effective-n`, or when analyzing whether a chain of N signals is really N independent gates or actually fewer. " +
    "Returns participation-ratio effective-N count, redundant pairs (|r|>threshold), and a reasoning string.",
  inputSchema: z.object({
    correlationMatrix: z
      .array(z.array(z.number()))
      .optional()
      .describe(
        "Pairwise correlation matrix (square, symmetric, diagonal = 1). Either this or signals must be provided.",
      ),
    signals: z
      .array(
        z.object({
          signalId: z.string(),
          values: z.array(z.number()),
        }),
      )
      .optional()
      .describe("Raw signal series; correlation computed internally."),
    labels: z
      .array(z.string())
      .optional()
      .describe("Labels for the matrix rows (ignored if signals supplied)."),
    redundantThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.7)
      .describe("|r| above which a pair is flagged redundant. Default 0.7."),
  }),
  outputSchema: z.object({
    rawN: z.number(),
    effectiveN: z.number(),
    averagePairwiseAbsCorr: z.number(),
    redundantPairCount: z.number(),
    redundantPairs: z.array(
      z.object({
        a: z.string(),
        b: z.string(),
        correlation: z.number(),
      }),
    ),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeEffectiveN({
      correlationMatrix: input.correlationMatrix,
      signals: input.signals as never,
      labels: input.labels,
      redundantThreshold: input.redundantThreshold,
    });

    const summary =
      `Chain depth: ${result.rawN}, effective independent: ${result.effectiveN.toFixed(2)}. ` +
      result.reasoning;

    recordStructuredObservation({
      eventType: "effective_n.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_effective_n",
      toolName: "compute_effective_n",
      outcome: "info",
      details: {
        ...(effectiveNToPayload(result) as Record<string, unknown>),
      },
    });

    return {
      rawN: result.rawN,
      effectiveN: Number(result.effectiveN.toFixed(4)),
      averagePairwiseAbsCorr: Number(result.averagePairwiseAbsCorr.toFixed(4)),
      redundantPairCount: result.redundantPairs.length,
      redundantPairs: result.redundantPairs.slice(0, 20).map((p) => ({
        a: p.a,
        b: p.b,
        correlation: Number(p.correlation.toFixed(4)),
      })),
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const effectiveNTools = {
  compute_effective_n: effectiveNDiagnosticTool,
};
