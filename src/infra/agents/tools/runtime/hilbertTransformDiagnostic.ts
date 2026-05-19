/**
 * Hilbert Transform Diagnostic Tool — exposed via /hilbert.
 *
 * Wraps `computeHilbertTransform` (TS6) — Ehlers's 7-tap truncated
 * Hilbert Transform for instantaneous phase extraction.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeHilbertTransform,
  hilbertToPayload,
} from "../../../trading/quant/hilbertTransform.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const hilbertTransformDiagnosticTool = createTool({
  id: "compute_hilbert_transform",
  description:
    "Compute Ehlers's truncated Hilbert Transform to extract instantaneous phase from a short price window. " +
    "Use when the operator asks `/hilbert`, or when distinguishing a cyclic regime from a trending or noisy one. " +
    "Returns the current phase angle in degrees and a cyclic / non-cyclic verdict.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(7).describe("Price series, newest last (≥7 samples)."),
    detrendPeriod: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Pre-detrend by subtracting an SMA of this many bars. 0 = no detrend."),
  }),
  outputSchema: z.object({
    currentPhase: z.number().nullable(),
    cyclic: z.boolean(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeHilbertTransform({
      prices: input.prices,
      detrendPeriod: input.detrendPeriod,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "hilbert_transform.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_hilbert_transform",
      toolName: "compute_hilbert_transform",
      outcome: "info",
      details: { ...(hilbertToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentPhase: Number.isFinite(result.currentPhase)
        ? Number(result.currentPhase.toFixed(2))
        : null,
      cyclic: result.cyclic,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const hilbertTransformTools = { compute_hilbert_transform: hilbertTransformDiagnosticTool };
