/**
 * Delta-Price Divergence Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `detectDeltaPriceDivergence` from
 * core/alpha/delta-price-divergence.ts. Order-flow exhaustion classifier:
 * compares signed price-change vs cumulative-delta over a lookback to
 * detect buyer/seller exhaustion as reversal candidates. Pedigree: Mati
 * Conti 2026 market-maker framing; standard prop-trading order-flow lit.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { detectDeltaPriceDivergence } from "../../../../core/alpha/delta-price-divergence.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const deltaPriceDivergenceDiagnosticTool = createTool({
  id: "detect_delta_price_divergence",
  description:
    "Detect order-flow exhaustion via price-vs-delta divergence. Price up + delta down/negative = " +
    "BUYER exhaustion (bearish reversal candidate). Price down + delta up/positive = SELLER " +
    "exhaustion (bullish reversal candidate). Returns verdict: bullish_divergence_signal / " +
    "bearish_divergence_signal / aligned / insufficient_signal / insufficient_data, plus per-axis " +
    "diagnostics and divergence magnitude (0..1). Distinct from delta-ladder (raw indicator) and " +
    "sellers-exhaustion strategy (volume-climax pattern). Composes with ensemble-signal-combiner.",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          close: z.number().positive(),
          delta: z
            .number()
            .describe("Per-bar delta = aggressive-buy volume − aggressive-sell volume (signed)."),
        }),
      )
      .min(1)
      .describe("OHLCV+delta bars, oldest → newest."),
    lookbackBars: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Bars to evaluate divergence over. Default 4."),
    minPriceMovePct: z
      .number()
      .min(0)
      .optional()
      .describe("Min |price change|/start. Below this, price is 'flat'. Default 0.005."),
    minAbsoluteDelta: z
      .number()
      .min(0)
      .optional()
      .describe("Min |cumulative delta| for delta to register. Default 0."),
    minBars: z.number().int().min(2).optional().describe("Min input bars. Default 5."),
  }),
  outputSchema: z.object({
    totalBars: z.number(),
    lookbackUsed: z.number(),
    startClose: z.number(),
    endClose: z.number(),
    priceChange: z.number(),
    priceChangePct: z.number(),
    cumulativeDelta: z.number(),
    absoluteDelta: z.number(),
    priceDirection: z.enum(["up", "down", "flat"]),
    deltaDirection: z.enum(["up", "down", "flat"]),
    divergenceType: z.enum([
      "aligned_up",
      "aligned_down",
      "bullish_divergence",
      "bearish_divergence",
      "insufficient_signal",
    ]),
    divergenceMagnitude: z.number(),
    verdict: z.enum([
      "bullish_divergence_signal",
      "bearish_divergence_signal",
      "aligned",
      "insufficient_signal",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = detectDeltaPriceDivergence(input.bars, {
      lookbackBars: input.lookbackBars,
      minPriceMovePct: input.minPriceMovePct,
      minAbsoluteDelta: input.minAbsoluteDelta,
      minBars: input.minBars,
    });
    recordStructuredObservation({
      eventType: "delta_price_divergence.detected",
      workflow: "analysis",
      source: "agent_tool",
      component: "detect_delta_price_divergence",
      toolName: "detect_delta_price_divergence",
      outcome:
        result.verdict === "bullish_divergence_signal" ||
        result.verdict === "bearish_divergence_signal"
          ? "info"
          : "info",
      details: {
        verdict: result.verdict,
        divergenceType: result.divergenceType,
        divergenceMagnitude: result.divergenceMagnitude,
        priceChangePct: result.priceChangePct,
        cumulativeDelta: result.cumulativeDelta,
      },
    });
    return result;
  },
});

export const deltaPriceDivergenceTools = {
  detect_delta_price_divergence: deltaPriceDivergenceDiagnosticTool,
};
