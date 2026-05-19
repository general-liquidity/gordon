/**
 * KST Index Diagnostic Tool — exposed via /kst.
 *
 * Wraps `computeKst` (TS12) — Pring's 4-ROC composite momentum.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeKst, kstToPayload } from "../../../trading/quant/kstIndex.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const kstIndexDiagnosticTool = createTool({
  id: "compute_kst_index",
  description:
    "Compute Pring's KST (Know Sure Thing) — four smoothed rates-of-change at progressively longer horizons, weighted 1/2/3/4 and summed. " +
    "Use when the operator asks `/kst`. Returns current KST value, signal-line value, and the most-recent bullish/bearish crossover.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(45).describe("Price series, newest last."),
    signalPeriod: z.number().int().positive().default(9).describe("Signal SMA period. Default 9."),
  }),
  outputSchema: z.object({
    currentKst: z.number().nullable(),
    currentSignal: z.number().nullable(),
    lastCross: z.enum(["bullish", "bearish", "none"]),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeKst({ prices: input.prices, signalPeriod: input.signalPeriod });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "kst_index.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_kst_index",
      toolName: "compute_kst_index",
      outcome: "info",
      details: { ...(kstToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentKst: Number.isFinite(result.currentKst)
        ? Number(result.currentKst.toFixed(4))
        : null,
      currentSignal: Number.isFinite(result.currentSignal)
        ? Number(result.currentSignal.toFixed(4))
        : null,
      lastCross: result.lastCross,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const kstIndexTools = { compute_kst_index: kstIndexDiagnosticTool };
