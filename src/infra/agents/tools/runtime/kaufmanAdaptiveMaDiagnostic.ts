/**
 * Kaufman Adaptive MA Diagnostic Tool — exposed via /kama.
 *
 * Wraps `computeKama` (TS2) — the book's namesake adaptive EMA whose
 * smoothing constant varies with the efficiency ratio.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeKama, kamaToPayload } from "../../../trading/quant/kaufmanAdaptiveMA.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const kaufmanAdaptiveMaDiagnosticTool = createTool({
  id: "compute_kaufman_adaptive_ma",
  description:
    "Compute Kaufman's Adaptive Moving Average (KAMA). " +
    "Use when the operator asks `/kama`, or when a noise-aware trend filter is needed: KAMA tracks price quickly in trending regimes and effectively flattens in choppy ones. " +
    "Returns the current KAMA value, current smoothing constant, trend direction, and last trend-change index.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(11).describe("Price series, newest last."),
    erPeriod: z.number().int().positive().default(10).describe("Efficiency-ratio lookback. Default 10."),
    fastPeriod: z.number().int().positive().default(2).describe("Fast EMA period. Default 2."),
    slowPeriod: z.number().int().positive().default(30).describe("Slow EMA period. Default 30."),
    trendFilterStdevs: z
      .number()
      .min(0)
      .default(0.1)
      .describe("Trend-flip filter as a fraction of KAMA-change stdev. Default 0.1."),
  }),
  outputSchema: z.object({
    currentKama: z.number().nullable(),
    currentSc: z.number().nullable(),
    trend: z.enum(["up", "down", "flat"]),
    trendChangeIndex: z.number().int().nullable(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeKama({
      prices: input.prices,
      erPeriod: input.erPeriod,
      fastPeriod: input.fastPeriod,
      slowPeriod: input.slowPeriod,
      trendFilterStdevs: input.trendFilterStdevs,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "kaufman_adaptive_ma.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_kaufman_adaptive_ma",
      toolName: "compute_kaufman_adaptive_ma",
      outcome: "info",
      details: { ...(kamaToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentKama: Number.isFinite(result.currentKama) ? Number(result.currentKama.toFixed(5)) : null,
      currentSc: Number.isFinite(result.currentSc) ? Number(result.currentSc.toFixed(5)) : null,
      trend: result.trend,
      trendChangeIndex: result.trendChangeIndex,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const kaufmanAdaptiveMaTools = {
  compute_kaufman_adaptive_ma: kaufmanAdaptiveMaDiagnosticTool,
};
