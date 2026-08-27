/**
 * Vol-Scaled Sizing Diagnostic Tool — exposed via /vol-size.
 *
 * Wraps `computeVolScaledSizing` to turn a vol estimate into a position
 * multiplier with operator-visible reasoning.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeVolScaledSizing,
  volScaledSizingToPayload,
} from "../../../trading/quant/volScaledSizing.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const volScaledSizingDiagnosticTool = createTool({
  id: "compute_vol_scaled_sizing",
  description:
    "Map a current volatility level to a discrete position multiplier with quantile thresholds. " +
    "Use when the operator asks `/vol-size`, or when the sizer needs to scale up/down based on the prevailing vol regime. " +
    "Returns multiplier + verdict (size_up / size_normal / size_down / refuse).",
  inputSchema: z.object({
    currentVol: z.number().describe("Current annualized volatility (decimal, e.g. 0.20 = 20%)."),
    mode: z
      .enum(["scale_up", "scale_down"])
      .default("scale_down")
      .describe(
        "scale_down dampens size in storms (directional strategies); scale_up adds size (premium-collection). Default scale_down.",
      ),
    lowVol: z
      .number()
      .min(0)
      .default(0.2)
      .describe("Vol level below which 'calm' band applies. Default 0.20."),
    highVol: z
      .number()
      .min(0)
      .default(0.3)
      .describe("Vol level above which 'high' band applies. Default 0.30."),
    refuseAbove: z
      .number()
      .min(0)
      .default(0.6)
      .describe("Vol level above which size = 0 (refuse). Default 0.60."),
  }),
  outputSchema: z.object({
    multiplier: z.number(),
    verdict: z.enum(["size_up", "size_normal", "size_down", "refuse"]),
    appliedBandLabel: z.string().nullable(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeVolScaledSizing({
      currentVol: input.currentVol,
      mode: input.mode,
      lowVol: input.lowVol,
      highVol: input.highVol,
      refuseAbove: input.refuseAbove,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "vol_scaled_sizing.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_vol_scaled_sizing",
      toolName: "compute_vol_scaled_sizing",
      outcome: result.verdict === "refuse" ? "failure" : "info",
      details: { ...(volScaledSizingToPayload(result) as Record<string, unknown>) },
    });
    return {
      multiplier: Number(result.multiplier.toFixed(4)),
      verdict: result.verdict,
      appliedBandLabel: result.appliedBand.label ?? null,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const volScaledSizingTools = { compute_vol_scaled_sizing: volScaledSizingDiagnosticTool };
