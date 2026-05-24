/**
 * FIP Momentum Quality Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `scoreFipMomentum` from core/alpha/fip-momentum-quality.ts.
 * Frog-in-the-Pan path-smoothness scoring (Frazzini–Quan–Israel–Moskowitz).
 * Distinguishes smooth-diffusion momentum from spiky-concentrated returns
 * even when total returns are identical.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { scoreFipMomentum } from "../../../../core/alpha/fip-momentum-quality.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const fipMomentumQualityDiagnosticTool = createTool({
  id: "score_fip_momentum_quality",
  description:
    "Score path-smoothness of momentum via Frog-in-the-Pan: FIP = sign(return) × (N_neg - N_pos) / T. " +
    "More negative FIP = smoother (continuation likely); more positive = spiky (mean-reversion likely). " +
    "Returns per-asset FIP, quality verdict (smooth_momentum / mixed / spiky_momentum), return rank, " +
    "and a high-quality momentum filter intersecting top-return + smooth-FIP. Distinct from " +
    "cross-sectional-momentum (return-only ranking) and streak-detector (current-streak length). " +
    "Compose with cross-sectional-momentum for two-stage screening.",
  inputSchema: z.object({
    assets: z
      .array(
        z.object({
          symbol: z.string(),
          dailyReturns: z.array(z.number()).min(1),
        }),
      )
      .min(1)
      .describe("Per-asset daily return series (oldest → newest, fractions)."),
    lookbackDays: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Lookback window in days. Default uses full supplied series."),
    zeroTolerance: z
      .number()
      .min(0)
      .optional()
      .describe("Below this magnitude, returns count as zero days. Default 0."),
    smoothFipThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("FIP magnitude separating smooth/mixed/spiky. Default 0.10."),
    topReturnFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Top fraction by return considered for high-quality screen. Default 0.20."),
    minSampleSize: z
      .number()
      .int()
      .min(5)
      .optional()
      .describe("Min days of valid returns per asset. Default 20."),
    minAssets: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Min total assets for a cross-sectional verdict. Default 3."),
  }),
  outputSchema: z.object({
    totalAssets: z.number(),
    validAssets: z.number(),
    lookbackUsed: z.number(),
    topReturnFraction: z.number(),
    smoothFipThreshold: z.number(),
    perAsset: z.array(
      z.object({
        symbol: z.string(),
        totalReturn: z.number(),
        positiveDays: z.number(),
        negativeDays: z.number(),
        zeroDays: z.number(),
        sampleSize: z.number(),
        fip: z.number(),
        fipQuality: z.enum([
          "smooth_momentum",
          "mixed_momentum",
          "spiky_momentum",
          "no_direction",
        ]),
        returnRank: z.number(),
        returnPercentile: z.number(),
        isHighQualityMomentum: z.boolean(),
      }),
    ),
    highQualityMomentum: z.array(z.string()),
    spikyTopReturn: z.array(z.string()),
    verdict: z.enum([
      "quality_momentum_found",
      "weak_quality_momentum",
      "no_directional_momentum",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = scoreFipMomentum(input.assets, {
      lookbackDays: input.lookbackDays,
      zeroTolerance: input.zeroTolerance,
      smoothFipThreshold: input.smoothFipThreshold,
      topReturnFraction: input.topReturnFraction,
      minSampleSize: input.minSampleSize,
      minAssets: input.minAssets,
    });
    recordStructuredObservation({
      eventType: "fip_momentum_quality.scored",
      workflow: "analysis",
      source: "agent_tool",
      component: "score_fip_momentum_quality",
      toolName: "score_fip_momentum_quality",
      outcome:
        result.verdict === "weak_quality_momentum" ||
        result.verdict === "insufficient_data"
          ? "failure"
          : "info",
      details: {
        verdict: result.verdict,
        validAssets: result.validAssets,
        highQualityCount: result.highQualityMomentum.length,
        spikyTopReturnCount: result.spikyTopReturn.length,
      },
    });
    return result;
  },
});

export const fipMomentumQualityTools = {
  score_fip_momentum_quality: fipMomentumQualityDiagnosticTool,
};
