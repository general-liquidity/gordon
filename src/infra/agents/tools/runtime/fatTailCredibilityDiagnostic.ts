/**
 * Fat-Tail Credibility Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `estimateFatTailCredibility` from core/alpha/fat-tail-credibility.ts.
 * Hill tail-index estimator + Taleb sample-size multiplier. Companion to
 * `backtestCredibility` (PSR/DSR/minTRL/CPCV) — supplies the fat-tail
 * correction multiplier that minTRL's Gaussian-derived estimate lacks.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { estimateFatTailCredibility } from "../../../../core/alpha/fat-tail-credibility.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const fatTailCredibilityDiagnosticTool = createTool({
  id: "estimate_fat_tail_credibility",
  description:
    "Estimate the tail index α of a return series via Hill's estimator and output a sample-size " +
    "multiplier per Taleb's rule of thumb. Verdict: gaussian_like (α > 3, multiplier 1×) / " +
    "moderately_heavy / heavy_tailed (α ∈ (1.5, 2], 10×) / very_heavy_tailed / " +
    "extreme_heavy_tailed (α ≤ 1, no finite mean, ∞×) / insufficient_data. If caller supplies " +
    "baselineGaussianSampleSize (e.g., backtestCredibility's minTRL), returns the fat-tail-adjusted " +
    "minimum. Distinct from loSharpeCorrection (autocorrelation) and tail-conditional-hedge (hedging).",
  inputSchema: z.object({
    returns: z
      .array(z.number())
      .min(1)
      .describe("Return series (any units). Absolute values used for tail estimation."),
    kFraction: z
      .number()
      .min(0.01)
      .max(0.5)
      .optional()
      .describe("Primary fraction of upper-order statistics for Hill k. Default 0.10."),
    kFractionGrid: z
      .array(z.number().min(0.01).max(0.5))
      .optional()
      .describe(
        "Grid of k fractions for stability assessment. Default [0.05, 0.075, 0.10, 0.15, 0.20].",
      ),
    minSampleSize: z
      .number()
      .int()
      .min(20)
      .optional()
      .describe("Minimum sample size for a verdict. Default 50."),
    baselineGaussianSampleSize: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Gaussian-derived sample requirement (e.g., minTRL). Unlocks adjusted output."),
  }),
  outputSchema: z.object({
    sampleSize: z.number(),
    effectiveSampleSize: z.number(),
    tailIndex: z.number(),
    tailIndexStdError: z.number(),
    tailIndexCI: z.object({ low: z.number(), high: z.number() }),
    perK: z.array(
      z.object({
        kFraction: z.number(),
        k: z.number(),
        alpha: z.number(),
      }),
    ),
    tailIndexRange: z.object({ min: z.number(), max: z.number() }),
    fatTailClass: z.enum([
      "gaussian_like",
      "moderately_heavy",
      "heavy_tailed",
      "very_heavy_tailed",
      "extreme_heavy_tailed",
      "insufficient_data",
    ]),
    sampleSizeMultiplier: z.number(),
    adjustedMinimumSampleSize: z.number().nullable(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = estimateFatTailCredibility({
      returns: input.returns,
      kFraction: input.kFraction,
      kFractionGrid: input.kFractionGrid,
      minSampleSize: input.minSampleSize,
      baselineGaussianSampleSize: input.baselineGaussianSampleSize,
    });
    recordStructuredObservation({
      eventType: "fat_tail_credibility.estimated",
      workflow: "audit",
      source: "agent_tool",
      component: "estimate_fat_tail_credibility",
      toolName: "estimate_fat_tail_credibility",
      outcome:
        result.fatTailClass === "gaussian_like" || result.fatTailClass === "moderately_heavy"
          ? "info"
          : "failure",
      details: {
        fatTailClass: result.fatTailClass,
        tailIndex: result.tailIndex,
        sampleSizeMultiplier: Number.isFinite(result.sampleSizeMultiplier)
          ? result.sampleSizeMultiplier
          : -1,
        adjustedMinimumSampleSize:
          result.adjustedMinimumSampleSize === Infinity ? -1 : result.adjustedMinimumSampleSize,
      },
    });
    return result;
  },
});

export const fatTailCredibilityTools = {
  estimate_fat_tail_credibility: fatTailCredibilityDiagnosticTool,
};
