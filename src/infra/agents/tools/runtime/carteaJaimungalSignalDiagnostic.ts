/**
 * Cartea-Jaimungal Signal-Driven Execution Diagnostic Tool — CJ1 wrapper.
 *
 * Agent-callable. The agent supplies a momentum/drift estimate from
 * Gordon's signal layer (Kalman-beta + regime detector + market-profile
 * trend), an execution horizon, and the parent order's remaining
 * inventory — and the tool returns the optimal trading speed that
 * weighs drift capture against impact cost.
 *
 * No slash command: same gating as CJ2-CJ4 — the natural invocation is
 * the agent calling it internally when planning execution. A future
 * "CJ execution mode" alongside TWAP/VWAP/POV/Iceberg would be the
 * consumer.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeCarteaJaimungalSignalSpeed,
  carteaJaimungalSignalToPayload,
} from "../../../trading/quant/carteaJaimungalSignal.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const carteaJaimungalSignalDiagnosticTool = createTool({
  id: "compute_cartea_jaimungal_signal_speed",
  description:
    "Compute the Cartea-Jaimungal optimal trading speed for a parent order with a constant drift signal. " +
    "Generalizes TWAP/Almgren-Chriss by incorporating a momentum/drift estimate μ to capture favorable price moves. " +
    "Use before kicking off execution when the operator has a directional view, or when comparing the cost of " +
    "patience against an expected drift. Returns speed in inventory-units-per-time.",
  inputSchema: z.object({
    timeRemaining: z
      .number()
      .positive()
      .describe("Time remaining in the execution horizon (same units as drift estimate)."),
    inventoryRemaining: z
      .number()
      .min(0)
      .describe("Inventory remaining to execute (positive — total quantity yet to fill)."),
    side: z.enum(["BUY", "SELL"]).describe("Direction of the parent order."),
    driftEstimate: z
      .number()
      .describe("Expected price drift μ (price change per unit time). 0 = no signal."),
    impactCoef: z
      .number()
      .positive()
      .describe("Linear temporary-impact coefficient k. Calibrate to venue/symbol."),
    runningPenalty: z
      .number()
      .min(0)
      .optional()
      .describe("Running inventory penalty φ (Almgren-Chriss urgency). 0 = TWAP baseline."),
  }),
  outputSchema: z.object({
    tradingSpeed: z.number(),
    baselineSpeed: z.number(),
    driftAdjustment: z.number(),
    urgencyRate: z.number(),
    impliedFinishTime: z.number().nullable(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeCarteaJaimungalSignalSpeed({
      timeRemaining: input.timeRemaining,
      inventoryRemaining: input.inventoryRemaining,
      side: input.side,
      driftEstimate: input.driftEstimate,
      impactCoef: input.impactCoef,
      runningPenalty: input.runningPenalty,
    });
    recordStructuredObservation({
      eventType: "cartea_jaimungal_signal.requested",
      workflow: "execution_planning",
      source: "agent_tool",
      component: "compute_cartea_jaimungal_signal_speed",
      toolName: "compute_cartea_jaimungal_signal_speed",
      outcome: "info",
      details: { ...(carteaJaimungalSignalToPayload(result) as Record<string, unknown>) },
    });
    return {
      tradingSpeed: Number(result.tradingSpeed.toFixed(6)),
      baselineSpeed: Number(result.baselineSpeed.toFixed(6)),
      driftAdjustment: Number(result.driftAdjustment.toFixed(6)),
      urgencyRate: Number(result.urgencyRate.toFixed(6)),
      impliedFinishTime: Number.isFinite(result.impliedFinishTime)
        ? Number(result.impliedFinishTime.toFixed(4))
        : null,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const carteaJaimungalSignalTools = {
  compute_cartea_jaimungal_signal_speed: carteaJaimungalSignalDiagnosticTool,
};
