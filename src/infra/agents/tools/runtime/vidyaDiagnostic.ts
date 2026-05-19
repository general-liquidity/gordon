/**
 * VIDYA Diagnostic Tool — exposed via /vidya.
 *
 * Wraps `computeVidya` (TS7) — Chande's stdev-ratio adaptive MA.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeVidya, vidyaToPayload } from "../../../trading/quant/vidya.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const vidyaDiagnosticTool = createTool({
  id: "compute_vidya",
  description:
    "Compute Chande's VIDYA — Variable Index Dynamic Average — an adaptive MA whose smoothing varies with relative volatility (stdev fast / stdev slow). " +
    "Use when the operator asks `/vidya`, or when an adaptive MA alternative to KAMA is preferred (vol-ratio vs trendiness-ratio adaptation).",
  inputSchema: z.object({
    prices: z.array(z.number()).min(31).describe("Price series, newest last."),
    fastPeriod: z.number().int().positive().default(9).describe("Short stdev window. Default 9."),
    slowPeriod: z.number().int().positive().default(30).describe("Long stdev window. Default 30."),
    baseAlpha: z.number().min(0).max(1).default(0.2).describe("Base smoothing constant. Default 0.20."),
  }),
  outputSchema: z.object({
    currentVidya: z.number().nullable(),
    currentAlpha: z.number().nullable(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeVidya({
      prices: input.prices,
      fastPeriod: input.fastPeriod,
      slowPeriod: input.slowPeriod,
      baseAlpha: input.baseAlpha,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "vidya.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_vidya",
      toolName: "compute_vidya",
      outcome: "info",
      details: { ...(vidyaToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentVidya: Number.isFinite(result.currentVidya)
        ? Number(result.currentVidya.toFixed(5))
        : null,
      currentAlpha: Number.isFinite(result.currentAlpha)
        ? Number(result.currentAlpha.toFixed(5))
        : null,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const vidyaTools = { compute_vidya: vidyaDiagnosticTool };
