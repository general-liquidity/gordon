/**
 * VCP Contraction Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeVcpContraction` from core/alpha/vcp-contraction.ts.
 * Minervini/Qullamaggie multi-day contraction: body + range + volume
 * all shrinking → "fully loaded spring".
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeVcpContraction } from "../../../../core/alpha/vcp-contraction.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const vcpContractionDiagnosticTool = createTool({
  id: "analyze_vcp_contraction",
  description:
    "Detect VCP-style multi-day contraction: candle body shrinking, candle range shrinking, " +
    "AND USD volume declining over the lookback. Returns contracting-axes count (0-3) and a verdict: " +
    "spring_ready (all 3 + tight range + low rel-vol) / contracting (≥2 axes) / mixed (1 axis) / " +
    "expanding (0 axes). Use to identify the 'fully loaded spring' setup that precedes momentum " +
    "breakouts — distinct from volume-trend (slope only) and squeeze-breakout (BB-keltner geometry).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          open: z.number().positive(),
          high: z.number().positive(),
          low: z.number().positive(),
          close: z.number().positive(),
          volume: z.number().min(0),
        }),
      )
      .min(4)
      .describe("OHLCV bars, ordered oldest → newest."),
    window: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Contraction window in candles. Default 5."),
    minCandles: z.number().int().min(2).optional().describe("Min candles for verdict. Default 4."),
    bodyShrinkThresholdPct: z
      .number()
      .optional()
      .describe("% per candle for body contraction. Default -1.0."),
    rangeShrinkThresholdPct: z
      .number()
      .optional()
      .describe("% per candle for range contraction. Default -1.0."),
    volumeShrinkThresholdPct: z
      .number()
      .optional()
      .describe("% per candle for vol contraction. Default -2.0."),
    maxRelativeVolume: z
      .number()
      .positive()
      .optional()
      .describe("Max window/baseline vol ratio. Default 0.70."),
    maxRangeOverLow: z
      .number()
      .positive()
      .optional()
      .describe("Max window range / low. Default 0.10."),
  }),
  outputSchema: z.object({
    windowSize: z.number(),
    bodyShrinkSlopePct: z.number(),
    rangeShrinkSlopePct: z.number(),
    volumeSlopePct: z.number(),
    windowRangeOverLow: z.number(),
    relativeVolume: z.number(),
    contractingAxes: z.number(),
    contractionScore: z.number(),
    verdict: z.enum(["spring_ready", "contracting", "mixed", "expanding", "insufficient_data"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeVcpContraction(input.bars, {
      window: input.window,
      minCandles: input.minCandles,
      bodyShrinkThresholdPct: input.bodyShrinkThresholdPct,
      rangeShrinkThresholdPct: input.rangeShrinkThresholdPct,
      volumeShrinkThresholdPct: input.volumeShrinkThresholdPct,
      maxRelativeVolume: input.maxRelativeVolume,
      maxRangeOverLow: input.maxRangeOverLow,
    });
    recordStructuredObservation({
      eventType: "vcp_contraction.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_vcp_contraction",
      toolName: "analyze_vcp_contraction",
      outcome: "info",
      details: {
        verdict: result.verdict,
        contractingAxes: result.contractingAxes,
        contractionScore: result.contractionScore,
      },
    });
    return {
      windowSize: result.windowSize,
      bodyShrinkSlopePct: result.bodyShrinkSlopePct,
      rangeShrinkSlopePct: result.rangeShrinkSlopePct,
      volumeSlopePct: result.volumeSlopePct,
      windowRangeOverLow: result.windowRangeOverLow,
      relativeVolume: result.relativeVolume,
      contractingAxes: result.contractingAxes,
      contractionScore: result.contractionScore,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const vcpContractionTools = {
  analyze_vcp_contraction: vcpContractionDiagnosticTool,
};
