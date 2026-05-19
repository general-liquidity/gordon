/**
 * Divergence Index Diagnostic Tool — exposed via /divergence-index.
 *
 * Wraps `computeDivergenceIndex` (TS11) — Appel's volatility-adjusted
 * MACD variant with self-scaling stdev bands.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeDivergenceIndex,
  divergenceIndexToPayload,
} from "../../../trading/quant/divergenceIndex.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const divergenceIndexDiagnosticTool = createTool({
  id: "compute_divergence_index",
  description:
    "Compute Appel's Divergence Index — a volatility-adjusted MACD with stdev-scaled bands that self-adjust to vol regimes. " +
    "Use when the operator asks `/divergence-index`. Returns current DI value plus buy / sell / exit / none signal.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(41).describe("Price series, newest last."),
    fastPeriod: z.number().int().positive().default(10).describe("Fast MA period. Default 10."),
    slowPeriod: z.number().int().positive().default(40).describe("Slow MA period. Default 40."),
    bandFactor: z.number().min(0).default(1.0).describe("Stdev band multiplier. Default 1.0."),
  }),
  outputSchema: z.object({
    currentDi: z.number().nullable(),
    currentUpper: z.number().nullable(),
    currentLower: z.number().nullable(),
    currentSignal: z.enum(["buy", "sell", "exit", "none"]),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeDivergenceIndex({
      prices: input.prices,
      fastPeriod: input.fastPeriod,
      slowPeriod: input.slowPeriod,
      bandFactor: input.bandFactor,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "divergence_index.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_divergence_index",
      toolName: "compute_divergence_index",
      outcome: result.currentSignal === "none" ? "info" : "success",
      details: { ...(divergenceIndexToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentDi: Number.isFinite(result.currentDi) ? Number(result.currentDi.toFixed(5)) : null,
      currentUpper: Number.isFinite(result.currentUpper)
        ? Number(result.currentUpper.toFixed(5))
        : null,
      currentLower: Number.isFinite(result.currentLower)
        ? Number(result.currentLower.toFixed(5))
        : null,
      currentSignal: result.currentSignal,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const divergenceIndexTools = { compute_divergence_index: divergenceIndexDiagnosticTool };
