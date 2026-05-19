/**
 * Range Volatility Diagnostic Tool — exposed via /range-vol slash command.
 *
 * Wraps `computeRangeVolatility` to expose Parkinson + Garman-Klass
 * estimators as a Mastra tool. Tighter (lower-variance) vol estimates
 * than close-to-close at the same bar frequency, useful for short-window
 * regime detection.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeRangeVolatility,
  rangeVolatilityToPayload,
} from "../../../trading/quant/rangeVolatility.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const rangeVolatilityDiagnosticTool = createTool({
  id: "compute_range_volatility",
  description:
    "Compute Parkinson and Garman-Klass range-based annualized volatility from OHLC bars. " +
    "Use when the operator asks `/range-vol`, or when a short-window vol estimate is needed and close-to-close is too noisy. " +
    "Returns annualized Parkinson + GK + close-to-close vols plus the GK efficiency gain over close-to-close.",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          open: z.number().positive(),
          high: z.number().positive(),
          low: z.number().positive(),
          close: z.number().positive(),
        }),
      )
      .min(1)
      .describe("OHLC bars (any frequency). Invalid bars are skipped."),
    periodsPerYear: z
      .number()
      .positive()
      .default(365)
      .describe("Periods per year — 252 daily equity, 365 daily crypto, 24 hourly. Default 365."),
  }),
  outputSchema: z.object({
    parkinsonAnnualized: z.number(),
    garmanKlassAnnualized: z.number(),
    closeToCloseAnnualized: z.number().nullable(),
    sampleSize: z.number(),
    efficiencyGain: z.number().nullable(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeRangeVolatility({
      bars: input.bars,
      periodsPerYear: input.periodsPerYear,
    });

    const summary =
      `Parkinson: ${(result.parkinsonAnnualized * 100).toFixed(1)}% ann, ` +
      `Garman-Klass: ${(result.garmanKlassAnnualized * 100).toFixed(1)}% ann ` +
      `(${result.sampleSize} bars). ${result.reasoning}`;

    recordStructuredObservation({
      eventType: "range_volatility.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_range_volatility",
      toolName: "compute_range_volatility",
      outcome: "info",
      details: { ...(rangeVolatilityToPayload(result) as Record<string, unknown>) },
    });

    return {
      parkinsonAnnualized: Number(result.parkinsonAnnualized.toFixed(5)),
      garmanKlassAnnualized: Number(result.garmanKlassAnnualized.toFixed(5)),
      closeToCloseAnnualized: Number.isFinite(result.closeToCloseAnnualized)
        ? Number(result.closeToCloseAnnualized.toFixed(5))
        : null,
      sampleSize: result.sampleSize,
      efficiencyGain: Number.isFinite(result.efficiencyGain)
        ? Number(result.efficiencyGain.toFixed(3))
        : null,
      summary,
    };
  },
});

export const rangeVolatilityTools = {
  compute_range_volatility: rangeVolatilityDiagnosticTool,
};
