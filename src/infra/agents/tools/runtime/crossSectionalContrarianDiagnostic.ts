/**
 * Cross-Sectional Contrarian Sizer Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `sizeCrossSectionalContrarian` from core/alpha/cross-sectional-contrarian.ts.
 * Computes dollar-neutral contrarian weights: shorts winners, longs losers,
 * sized continuously by deviation from cross-sectional market average and
 * scaled by historical volatility. Inverse direction of cross-sectional-momentum.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { sizeCrossSectionalContrarian } from "../../../../core/alpha/cross-sectional-contrarian.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const crossSectionalContrarianDiagnosticTool = createTool({
  id: "size_cross_sectional_contrarian",
  description:
    "Compute dollar-neutral contrarian weights for a basket. Shorts winners + longs " +
    "losers vs the cross-sectional market average, sized by deviation magnitude and " +
    "scaled by historical volatility. Returns per-symbol weights + gross/net exposure. " +
    "Inverse direction of cross-sectional-momentum (continuous weighting, not quantile " +
    "buckets). Composes with regime-detection (reversion works in range, fails in trend).",
  inputSchema: z.object({
    assets: z
      .array(
        z.object({
          symbol: z.string(),
          prices: z.array(z.number()).min(2),
        }),
      )
      .min(2)
      .describe("Per-symbol price series ordered oldest → newest."),
    volatilityWeighting: z
      .enum(["none", "inverse_sigma", "inverse_sigma_squared"])
      .optional()
      .describe(
        "How to scale signal by per-asset σ. Default 'inverse_sigma'. " +
          "'inverse_sigma_squared' is mean-variance-optimal under diagonal-Σ.",
      ),
    minSymbols: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum universe size for a verdict. Default 3."),
    maxAbsoluteWeight: z
      .number()
      .min(0.01)
      .max(1)
      .optional()
      .describe("Max |weight| per asset post-normalization. Default 0.30."),
    minSigma: z
      .number()
      .min(0)
      .optional()
      .describe("Floor on σ used in denominator. Default 1e-4."),
  }),
  outputSchema: z.object({
    totalSymbols: z.number(),
    validSymbols: z.number(),
    marketReturn: z.number(),
    meanReturn: z.number(),
    returnDispersion: z.number(),
    weights: z.array(
      z.object({
        symbol: z.string(),
        returnFraction: z.number(),
        demeanedReturn: z.number(),
        volatility: z.number(),
        rawSignal: z.number(),
        weight: z.number(),
        side: z.enum(["long", "short", "flat"]),
      }),
    ),
    longBookGross: z.number(),
    shortBookGross: z.number(),
    netExposure: z.number(),
    grossExposure: z.number(),
    verdict: z.enum(["weighted", "insufficient_data", "no_dispersion", "degenerate_volatility"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = sizeCrossSectionalContrarian(input.assets, {
      volatilityWeighting: input.volatilityWeighting,
      minSymbols: input.minSymbols,
      maxAbsoluteWeight: input.maxAbsoluteWeight,
      minSigma: input.minSigma,
    });
    recordStructuredObservation({
      eventType: "cross_sectional_contrarian.sized",
      workflow: "analysis",
      source: "agent_tool",
      component: "size_cross_sectional_contrarian",
      toolName: "size_cross_sectional_contrarian",
      outcome: result.verdict === "weighted" ? "info" : "failure",
      details: {
        verdict: result.verdict,
        validSymbols: result.validSymbols,
        marketReturn: result.marketReturn,
        dispersion: result.returnDispersion,
        netExposure: result.netExposure,
        grossExposure: result.grossExposure,
      },
    });
    return {
      totalSymbols: result.totalSymbols,
      validSymbols: result.validSymbols,
      marketReturn: result.marketReturn,
      meanReturn: result.meanReturn,
      returnDispersion: result.returnDispersion,
      weights: result.weights,
      longBookGross: result.longBookGross,
      shortBookGross: result.shortBookGross,
      netExposure: result.netExposure,
      grossExposure: result.grossExposure,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const crossSectionalContrarianTools = {
  size_cross_sectional_contrarian: crossSectionalContrarianDiagnosticTool,
};
