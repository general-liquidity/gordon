/**
 * Elder Momentum Diagnostic Tools — exposed via /force-index and /elder-ray.
 *
 * Two paired tools wrapping `computeForceIndex` and `computeElderRay`
 * (TS8 and TS9) — middle-frame oscillators in Elder's Triple Screen.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeForceIndex,
  computeElderRay,
  forceIndexToPayload,
  elderRayToPayload,
} from "../../../trading/quant/elderMomentum.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const ohlcvSchema = z.object({
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});

export const forceIndexDiagnosticTool = createTool({
  id: "compute_force_index",
  description:
    "Compute Elder's Force Index: volume · (close − prev close), EMA-smoothed. " +
    "Use when the operator asks `/force-index`. Combines direction, magnitude, and conviction into one momentum measure.",
  inputSchema: z.object({
    bars: z.array(ohlcvSchema).min(2).describe("OHLCV bars, newest last."),
    emaPeriod: z.number().int().positive().default(2).describe("EMA smoothing period. Default 2."),
  }),
  outputSchema: z.object({
    current: z.number(),
    sign: z.enum(["positive", "negative", "zero"]),
    sampleSize: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeForceIndex({ bars: input.bars, emaPeriod: input.emaPeriod });
    const summary = `Force Index ${result.current.toFixed(2)} (${result.sign}) over ${result.sampleSize} bars`;
    recordStructuredObservation({
      eventType: "force_index.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_force_index",
      toolName: "compute_force_index",
      outcome: "info",
      details: { ...(forceIndexToPayload(result) as Record<string, unknown>) },
    });
    return {
      current: Number(result.current.toFixed(2)),
      sign: result.sign,
      sampleSize: result.sampleSize,
      summary,
    };
  },
});

export const elderRayDiagnosticTool = createTool({
  id: "compute_elder_ray",
  description:
    "Compute Elder-Ray Bull Power / Bear Power around an EMA centerline. " +
    "Use when the operator asks `/elder-ray`. Bull Power = High − EMA; Bear Power = Low − EMA. " +
    "Returns current bull/bear values and a bias classification (bullish / bearish / neutral).",
  inputSchema: z.object({
    bars: z.array(ohlcvSchema).min(13).describe("OHLCV bars, newest last."),
    emaPeriod: z.number().int().positive().default(13).describe("EMA centerline period. Default 13."),
  }),
  outputSchema: z.object({
    currentBull: z.number(),
    currentBear: z.number(),
    bias: z.enum(["bullish", "bearish", "neutral"]),
    sampleSize: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeElderRay({ bars: input.bars, emaPeriod: input.emaPeriod });
    const summary = `Elder-Ray bull ${result.currentBull.toFixed(4)} bear ${result.currentBear.toFixed(4)} → ${result.bias}`;
    recordStructuredObservation({
      eventType: "elder_ray.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_elder_ray",
      toolName: "compute_elder_ray",
      outcome: "info",
      details: { ...(elderRayToPayload(result) as Record<string, unknown>) },
    });
    return {
      currentBull: Number(result.currentBull.toFixed(5)),
      currentBear: Number(result.currentBear.toFixed(5)),
      bias: result.bias,
      sampleSize: result.sampleSize,
      summary,
    };
  },
});

export const elderMomentumTools = {
  compute_force_index: forceIndexDiagnosticTool,
  compute_elder_ray: elderRayDiagnosticTool,
};
