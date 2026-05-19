/**
 * TRIX Diagnostic Tool — exposed via /trix.
 *
 * Wraps `computeTrix` (TS10) — triple-EMA rate-of-change indicator.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeTrix, trixToPayload } from "../../../trading/quant/trix.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const trixDiagnosticTool = createTool({
  id: "compute_trix",
  description:
    "Compute TRIX — the percentage rate-of-change of a triple-smoothed EMA. " +
    "Use when the operator asks `/trix`, or as a low-noise momentum filter with reduced lag. " +
    "Returns the current TRIX value, signal-line value, and the most-recent bullish/bearish crossover.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(27).describe("Price series, newest last (≥3×period)."),
    period: z.number().int().positive().default(9).describe("EMA period. Default 9."),
    signalPeriod: z.number().int().positive().default(3).describe("Signal SMA period over TRIX. Default 3."),
  }),
  outputSchema: z.object({
    currentTrix: z.number().nullable(),
    currentSignal: z.number().nullable(),
    lastCross: z.enum(["bullish", "bearish", "none"]),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeTrix({
      prices: input.prices,
      period: input.period,
      signalPeriod: input.signalPeriod,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "trix.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_trix",
      toolName: "compute_trix",
      outcome: "info",
      details: { ...(trixToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentTrix: Number.isFinite(result.currentTrix)
        ? Number(result.currentTrix.toFixed(6))
        : null,
      currentSignal: Number.isFinite(result.currentSignal)
        ? Number(result.currentSignal.toFixed(6))
        : null,
      lastCross: result.lastCross,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const trixTools = { compute_trix: trixDiagnosticTool };
