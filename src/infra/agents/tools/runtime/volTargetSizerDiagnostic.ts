/**
 * Continuous Vol-Target Sizer Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `sizeWithVolTarget` from core/alpha/vol-target-sizer.ts.
 * Robert-Carver-style continuous vol-target sizing with leverage cap,
 * leverage floor, and no-trade-band on rebalancing. Companion to the
 * existing discrete `volScaledSizing` (band-multiplier 1×/2×/3×).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { sizeWithVolTarget } from "../../../../core/alpha/vol-target-sizer.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const volTargetSizerDiagnosticTool = createTool({
  id: "size_with_vol_target",
  description:
    "Continuous vol-target position sizing. Computes target notional = current × (target_vol / " +
    "current_vol), clipped to [floor, cap], with a no-trade band on rebalancing to cut transaction " +
    "cost. Returns raw + clipped multiplier, target notional, drift, expected vol, and verdict " +
    "(within_band_no_rebalance / rebalance_recommended / at_leverage_cap / at_leverage_floor / " +
    "insufficient_data). Distinct from volScaledSizing (discrete band multiplier) — this is the " +
    "continuous Carver-style sibling. Compose with kalmanVolatility for the current-vol input.",
  inputSchema: z.object({
    targetAnnualVol: z
      .number()
      .positive()
      .describe("Target annualized portfolio volatility (fraction, e.g. 0.10 = 10%)."),
    currentAnnualVol: z
      .number()
      .min(0)
      .describe("Current annualized vol estimate (e.g. from kalmanVolatility)."),
    currentNotionalFraction: z
      .number()
      .min(0)
      .optional()
      .describe("Current allocation as fraction of capital. Default 1.0."),
    leverageCap: z
      .number()
      .min(0)
      .optional()
      .describe("Max allowed multiplier on current notional. Default 2.0."),
    leverageFloor: z
      .number()
      .min(0)
      .optional()
      .describe("Min allowed multiplier. Default 0.20. Set to 0 for full-exit allowed."),
    noTradeBandPct: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Drift threshold (fraction) below which no rebalance is recommended. Default 0.10.",
      ),
    minCurrentVol: z
      .number()
      .min(0)
      .optional()
      .describe("Min current vol to avoid division explosions. Default 1e-6."),
  }),
  outputSchema: z.object({
    targetAnnualVol: z.number(),
    currentAnnualVol: z.number(),
    currentNotionalFraction: z.number(),
    rawMultiplier: z.number(),
    clippedMultiplier: z.number(),
    targetNotionalFraction: z.number(),
    driftFraction: z.number(),
    expectedAnnualVol: z.number(),
    cappedAtLimit: z.enum(["cap", "floor"]).nullable(),
    shouldRebalance: z.boolean(),
    verdict: z.enum([
      "within_band_no_rebalance",
      "rebalance_recommended",
      "at_leverage_cap",
      "at_leverage_floor",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = sizeWithVolTarget(
      {
        targetAnnualVol: input.targetAnnualVol,
        currentAnnualVol: input.currentAnnualVol,
        currentNotionalFraction: input.currentNotionalFraction,
      },
      {
        leverageCap: input.leverageCap,
        leverageFloor: input.leverageFloor,
        noTradeBandPct: input.noTradeBandPct,
        minCurrentVol: input.minCurrentVol,
      },
    );
    recordStructuredObservation({
      eventType: "vol_target_sizer.sized",
      workflow: "analysis",
      source: "agent_tool",
      component: "size_with_vol_target",
      toolName: "size_with_vol_target",
      outcome: result.verdict === "insufficient_data" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        rawMultiplier: result.rawMultiplier,
        clippedMultiplier: result.clippedMultiplier,
        driftFraction: result.driftFraction,
        cappedAtLimit: result.cappedAtLimit,
        expectedAnnualVol: result.expectedAnnualVol,
      },
    });
    return result;
  },
});

export const volTargetSizerTools = {
  size_with_vol_target: volTargetSizerDiagnosticTool,
};
