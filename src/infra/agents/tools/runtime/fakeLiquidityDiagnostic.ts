/**
 * Fake-Liquidity Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeFakeLiquidity` from core/alpha/fake-liquidity.ts. Detects
 * wash-traded / thin-book conditions by measuring per-candle move-per-
 * dollar with MAD-based modified-z outlier detection. Companion to
 * usdVolumeGate: usdVolumeGate answers "is headline volume big enough?";
 * this answers "given that headline volume, is the BOOK real enough to
 * back it?". Both should pass before sizing a position.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeFakeLiquidity } from "../../../../core/alpha/fake-liquidity.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const fakeLiquidityDiagnosticTool = createTool({
  id: "analyze_fake_liquidity",
  description:
    "Detect wash-trading / thin-book conditions. Computes per-candle move-per-dollar " +
    "and flags outliers using a MAD-based modified-z test (robust to heavy contamination). " +
    "Returns real_liquidity / suspicious / fake_liquidity verdict. Use AFTER usdVolumeGate " +
    "passes — headline volume can be wash-traded; this exposes that.",
  inputSchema: z.object({
    candles: z
      .array(
        z.object({
          open: z.number().positive(),
          close: z.number().positive(),
          high: z.number().positive(),
          low: z.number().positive(),
          volume: z.number().min(0),
        }),
      )
      .min(20)
      .describe("OHLCV candles. Need ≥ 20 for a verdict (default minCandles=20)."),
    window: z
      .number()
      .int()
      .min(5)
      .optional()
      .describe("Lookback window in candles. Default 60."),
    outlierZThreshold: z
      .number()
      .positive()
      .optional()
      .describe("Modified-z threshold (Iglewicz-Hoaglin). Default 3.5."),
    outlierFractionThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Fraction of outliers in window that trips 'suspicious'. Default 0.10."),
  }),
  outputSchema: z.object({
    windowSize: z.number(),
    medianMovePerDollar: z.number(),
    madMovePerDollar: z.number(),
    outlierCount: z.number(),
    outlierFraction: z.number(),
    verdict: z.enum(["real_liquidity", "suspicious", "fake_liquidity", "insufficient_data"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeFakeLiquidity(input.candles, {
      window: input.window,
      outlierZThreshold: input.outlierZThreshold,
      outlierFractionThreshold: input.outlierFractionThreshold,
    });
    recordStructuredObservation({
      eventType: "fake_liquidity.analyzed",
      workflow: "universe_filter",
      source: "agent_tool",
      component: "analyze_fake_liquidity",
      toolName: "analyze_fake_liquidity",
      outcome: result.verdict === "fake_liquidity" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        outlierCount: result.outlierCount,
        outlierFraction: result.outlierFraction,
        windowSize: result.windowSize,
      },
    });
    return {
      windowSize: result.windowSize,
      medianMovePerDollar: result.medianMovePerDollar,
      madMovePerDollar: result.madMovePerDollar,
      outlierCount: result.outlierCount,
      outlierFraction: result.outlierFraction,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const fakeLiquidityTools = {
  analyze_fake_liquidity: fakeLiquidityDiagnosticTool,
};
