/**
 * MESA Spectrum Diagnostic Tool — exposed via /mesa.
 *
 * Wraps `computeMesaSpectrum` (TS15) — Maximum Entropy Spectral
 * Analysis via Burg's AR fit. Recovers cycle structure from small
 * samples (~16-50 bars) where Fourier methods fail.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeMesaSpectrum,
  mesaToPayload,
} from "../../../trading/quant/mesaSpectrum.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const mesaSpectrumDiagnosticTool = createTool({
  id: "compute_mesa_spectrum",
  description:
    "Compute the maximum-entropy spectral density of a price series via Burg's autoregressive fit. " +
    "Use when the operator asks `/mesa`, or when looking for short-term cycle structure on small samples (Fourier needs ~256 bars; MESA works on ~16-50). " +
    "Returns the dominant period, peak/median power ratio, and the AR coefficients.",
  inputSchema: z.object({
    prices: z.array(z.number()).min(10).describe("Price series, newest last."),
    arOrder: z.number().int().positive().default(8).describe("AR model order. Default 8."),
    minPeriod: z.number().int().positive().default(4).describe("Shortest period to evaluate. Default 4."),
    maxPeriod: z.number().int().positive().default(40).describe("Longest period to evaluate. Default 40."),
  }),
  outputSchema: z.object({
    dominantPeriod: z.number().nullable(),
    peakStrengthRatio: z.number().nullable(),
    arCoefficients: z.array(z.number()),
    spectrumLength: z.number(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeMesaSpectrum({
      prices: input.prices,
      arOrder: input.arOrder,
      minPeriod: input.minPeriod,
      maxPeriod: input.maxPeriod,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "mesa_spectrum.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_mesa_spectrum",
      toolName: "compute_mesa_spectrum",
      outcome: "info",
      details: { ...(mesaToPayload(result) as Record<string, unknown>) },
    });
    return {
      dominantPeriod: Number.isFinite(result.dominantPeriod) ? result.dominantPeriod : null,
      peakStrengthRatio: Number.isFinite(result.peakStrengthRatio)
        ? Number(result.peakStrengthRatio.toFixed(3))
        : null,
      arCoefficients: result.arCoefficients.map((v) => Number(v.toFixed(6))),
      spectrumLength: result.spectrum.length,
      sampleSize: input.prices.length,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const mesaSpectrumTools = { compute_mesa_spectrum: mesaSpectrumDiagnosticTool };
