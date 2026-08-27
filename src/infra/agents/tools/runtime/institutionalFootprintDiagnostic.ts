/**
 * Institutional Footprint Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeInstitutionalFootprint` from
 * core/alpha/institutional-footprint.ts. Composite multi-bar
 * accumulation-signature detector: fires only when consecutive
 * elevated-volume bars + bounded directional move + signal candle +
 * shallow base + holds-MA all align. Diagnostic only, not a buy signal.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeInstitutionalFootprint } from "../../../../core/alpha/institutional-footprint.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const institutionalFootprintDiagnosticTool = createTool({
  id: "analyze_institutional_footprint",
  description:
    "Detect the multi-bar institutional-accumulation signature: ≥4 consecutive elevated-volume " +
    "bars + cumulative move in [20%, 40%] + at least one ≥10% signal bar + a subsequent shallow " +
    "tight base + latest close holding the 21-SMA. Returns a verdict (accumulation_visible / " +
    "partial_signature / parabolic_blowoff / chop_no_accumulation / insufficient_data) + per-axis " +
    "pass/fail report + signature score. Composite of streak/volume/VCP/MA-proximity — diagnostic, " +
    "not a buy signal. Distinct from analyze_vcp_contraction (base only) and detect_streak (run only).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          open: z.number(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
          volume: z.number(),
        }),
      )
      .min(1)
      .describe("OHLCV bars ordered oldest → newest. Needs ≥30 bars by default."),
    minConsecutiveVolumeBars: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Min consecutive elevated-volume bars in the run. Default 4."),
    elevatedVolumeMultiple: z
      .number()
      .min(1)
      .optional()
      .describe("Multiple of baseline volume that counts as 'elevated'. Default 1.2."),
    baselineVolumeWindow: z
      .number()
      .int()
      .min(5)
      .optional()
      .describe("Baseline volume window (bars before run start). Default 20."),
    minRunMove: z
      .number()
      .min(0)
      .optional()
      .describe("Lower bound on cumulative run move (fraction). Default 0.20."),
    maxRunMove: z
      .number()
      .min(0)
      .optional()
      .describe("Upper bound on cumulative run move; above = blowoff. Default 0.40."),
    minSignalBarBody: z
      .number()
      .min(0)
      .optional()
      .describe("Min |close-open|/open of at least one bar in the run. Default 0.10."),
    maxBaseRangeOverLow: z
      .number()
      .min(0)
      .optional()
      .describe("Max base (range/low) for shallow-base verdict. Default 0.10."),
    baseHoldingMaLength: z
      .number()
      .int()
      .min(5)
      .optional()
      .describe("SMA length for the holding-EMA check. Default 21."),
    minBars: z.number().int().min(10).optional().describe("Minimum bars in the input. Default 30."),
    minBaseLength: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Minimum base length (bars after peak). Default 3."),
  }),
  outputSchema: z.object({
    totalBars: z.number(),
    runStartIndex: z.number(),
    runEndIndex: z.number(),
    baseStartIndex: z.number(),
    baseEndIndex: z.number(),
    runMoveFraction: z.number(),
    maxSignalBarBody: z.number(),
    longestConsecutiveVolumeBars: z.number(),
    baselineVolume: z.number(),
    runVolume: z.number(),
    baseRangeOverLow: z.number(),
    holdingMaValue: z.number(),
    latestClose: z.number(),
    axesPassed: z.number(),
    axes: z.array(
      z.object({
        axis: z.enum([
          "consecutive_volume",
          "run_magnitude",
          "signal_bar",
          "base_tightness",
          "holds_ma",
        ]),
        passed: z.boolean(),
        observed: z.number(),
        threshold: z.number(),
        description: z.string(),
      }),
    ),
    verdict: z.enum([
      "accumulation_visible",
      "partial_signature",
      "parabolic_blowoff",
      "chop_no_accumulation",
      "insufficient_data",
    ]),
    signatureScore: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeInstitutionalFootprint(input.bars, {
      minConsecutiveVolumeBars: input.minConsecutiveVolumeBars,
      elevatedVolumeMultiple: input.elevatedVolumeMultiple,
      baselineVolumeWindow: input.baselineVolumeWindow,
      minRunMove: input.minRunMove,
      maxRunMove: input.maxRunMove,
      minSignalBarBody: input.minSignalBarBody,
      maxBaseRangeOverLow: input.maxBaseRangeOverLow,
      baseHoldingMaLength: input.baseHoldingMaLength,
      minBars: input.minBars,
      minBaseLength: input.minBaseLength,
    });
    recordStructuredObservation({
      eventType: "institutional_footprint.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_institutional_footprint",
      toolName: "analyze_institutional_footprint",
      outcome:
        result.verdict === "accumulation_visible"
          ? "info"
          : result.verdict === "parabolic_blowoff"
            ? "failure"
            : "info",
      details: {
        verdict: result.verdict,
        axesPassed: result.axesPassed,
        signatureScore: result.signatureScore,
        runMoveFraction: result.runMoveFraction,
        longestConsecutiveVolumeBars: result.longestConsecutiveVolumeBars,
        maxSignalBarBody: result.maxSignalBarBody,
        baseRangeOverLow: result.baseRangeOverLow,
      },
    });
    return result;
  },
});

export const institutionalFootprintTools = {
  analyze_institutional_footprint: institutionalFootprintDiagnosticTool,
};
