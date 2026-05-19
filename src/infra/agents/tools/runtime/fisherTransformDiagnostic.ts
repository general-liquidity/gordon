/**
 * Fisher Transform Diagnostic Tool — exposed via /fisher.
 *
 * Wraps `computeFisherTransform` (TS5) — Ehlers's Fisher Transform of
 * a price series, producing sharp turning-point signals.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeFisherTransform,
  fisherToPayload,
} from "../../../trading/quant/fisherTransform.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const fisherTransformDiagnosticTool = createTool({
  id: "compute_fisher_transform",
  description:
    "Compute the Fisher Transform of a price series. " +
    "Use when the operator asks `/fisher`, or when sharp turning-point signals are needed (Fisher peaks lead RSI/stochastic). " +
    "Returns the current Fisher value and a 1-bar lagged trigger line.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(10).describe("Price series, newest last."),
    period: z.number().int().positive().default(10).describe("High/low channel lookback. Default 10."),
  }),
  outputSchema: z.object({
    currentFisher: z.number().nullable(),
    currentTrigger: z.number().nullable(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeFisherTransform({ prices: input.prices, period: input.period });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "fisher_transform.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_fisher_transform",
      toolName: "compute_fisher_transform",
      outcome: "info",
      details: { ...(fisherToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentFisher: Number.isFinite(result.currentFisher)
        ? Number(result.currentFisher.toFixed(5))
        : null,
      currentTrigger: Number.isFinite(result.currentTrigger)
        ? Number(result.currentTrigger.toFixed(5))
        : null,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const fisherTransformTools = { compute_fisher_transform: fisherTransformDiagnosticTool };
