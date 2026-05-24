/**
 * Stall-Cut Tracker Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeStallCut` from core/alpha/stall-cut-tracker.ts.
 * Post-entry "is this acting right?" decision support — recommends cut
 * before stop is hit when price progression + volume confirmation are
 * absent. Composes with timeBasedExit (TM2 duration cousin).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeStallCut } from "../../../../core/alpha/stall-cut-tracker.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const stallCutTrackerDiagnosticTool = createTool({
  id: "analyze_stall_cut",
  description:
    "Post-entry stall diagnostic. Given entry + post-entry OHLCV bars + expected directional " +
    "move within N bars, returns a verdict: still_too_early / moving_as_expected / " +
    "stalling_cut_recommended / dead_money. Operationalizes Zanger's 'never own a stock not going " +
    "up' discipline. Distinct from streak-detector (pre-entry exhaustion), volume-exhaustion " +
    "(single-bar), and timeBasedExit (TM2 duration-only cousin — compose both for stronger gate).",
  inputSchema: z.object({
    side: z.enum(["LONG", "SHORT"]),
    entryPrice: z.number().positive(),
    postEntryBars: z
      .array(
        z.object({
          open: z.number(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
          volume: z.number().min(0),
        }),
      )
      .min(0),
    expectedMove: z
      .number()
      .positive()
      .describe("Expected directional move (fraction) within `expectedMoveByBars`."),
    expectedMoveByBars: z.number().int().positive(),
    baselineVolume: z
      .number()
      .positive()
      .optional()
      .describe("Pre-entry mean bar volume (optional). If absent, volume axis is skipped."),
    gracePeriodBars: z.number().int().min(0).optional(),
    onTrackProgressFraction: z.number().min(0).max(1).optional(),
    volumeConfirmMultiple: z.number().min(0).optional(),
    deadMoneyExtensionMultiple: z.number().min(1).optional(),
    deadMoneyProgressFraction: z.number().min(0).max(1).optional(),
  }),
  outputSchema: z.object({
    side: z.enum(["LONG", "SHORT"]),
    barsElapsed: z.number(),
    currentPrice: z.number(),
    progressFraction: z.number(),
    progressVsExpected: z.number(),
    proRatedExpected: z.number(),
    meanPostEntryVolume: z.number(),
    volumeMultiple: z.number().nullable(),
    progressOnTrack: z.boolean(),
    volumeConfirming: z.boolean().nullable(),
    verdict: z.enum([
      "still_too_early",
      "moving_as_expected",
      "stalling_cut_recommended",
      "dead_money",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeStallCut(
      {
        side: input.side,
        entryPrice: input.entryPrice,
        postEntryBars: input.postEntryBars,
        expectedMove: input.expectedMove,
        expectedMoveByBars: input.expectedMoveByBars,
        baselineVolume: input.baselineVolume,
      },
      {
        gracePeriodBars: input.gracePeriodBars,
        onTrackProgressFraction: input.onTrackProgressFraction,
        volumeConfirmMultiple: input.volumeConfirmMultiple,
        deadMoneyExtensionMultiple: input.deadMoneyExtensionMultiple,
        deadMoneyProgressFraction: input.deadMoneyProgressFraction,
      },
    );
    recordStructuredObservation({
      eventType: "stall_cut_tracker.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_stall_cut",
      toolName: "analyze_stall_cut",
      outcome:
        result.verdict === "stalling_cut_recommended" || result.verdict === "dead_money"
          ? "failure"
          : "info",
      details: {
        verdict: result.verdict,
        barsElapsed: result.barsElapsed,
        progressVsExpected: result.progressVsExpected,
        volumeMultiple: result.volumeMultiple,
      },
    });
    return result;
  },
});

export const stallCutTrackerTools = {
  analyze_stall_cut: stallCutTrackerDiagnosticTool,
};
