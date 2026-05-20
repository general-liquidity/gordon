/**
 * Revenge-Trade Guard Diagnostic Tool — D2 wrapper.
 *
 * Agent-callable. Before submitting a plan to the permission engine,
 * the agent calls this with the proposed size, the baseline size for
 * the strategy, and the prior closed trade's P&L. Returns proceed/flag/
 * block based on Druckenmiller's "never bet big to get even" rule.
 *
 * Composes with the existing anti-trap surface in
 * `src/infra/safety/anti-trap/` and with `swing-mandate.ts`'s
 * consecutive-loss stops.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  evaluateRevengeTradeGuard,
  revengeTradeGuardToPayload,
} from "../../../trading/quant/revengeTradeGuard.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const revengeTradeGuardDiagnosticTool = createTool({
  id: "evaluate_revenge_trade_guard",
  description:
    "Evaluate Druckenmiller's 'never bet big to get even' rule against the currently-proposed plan. " +
    "Detects when the proposed size is materially larger than the strategy's baseline AND the prior closed " +
    "trade was a loss — the canonical revenge-trade pattern. Default mode is informational (returns 'flag'); " +
    "mode='active' escalates to 'block'.",
  inputSchema: z.object({
    proposedPlanSize: z
      .number()
      .min(0)
      .describe("Size of the currently-proposed plan (any consistent unit)."),
    baselineSize: z
      .number()
      .positive()
      .describe("Baseline / average size for this strategy in the same unit."),
    priorTradePnL: z
      .number()
      .describe("P&L of the prior closed trade (negative = loss)."),
    sizeIncreaseThreshold: z
      .number()
      .gt(1)
      .optional()
      .describe("Multiplier above baseline that triggers the guard. Default 1.5."),
    mode: z
      .enum(["informational", "active"])
      .optional()
      .describe("informational (default) → flag + reasoning; active → block."),
  }),
  outputSchema: z.object({
    sizeMultipleVsBaseline: z.number(),
    priorTradeWasLoss: z.boolean(),
    sizeAboveThreshold: z.boolean(),
    revengeTradeDetected: z.boolean(),
    mode: z.enum(["informational", "active"]),
    recommendedAction: z.enum(["proceed", "flag", "block"]),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = evaluateRevengeTradeGuard({
      proposedPlanSize: input.proposedPlanSize,
      baselineSize: input.baselineSize,
      priorTradePnL: input.priorTradePnL,
      sizeIncreaseThreshold: input.sizeIncreaseThreshold,
      mode: input.mode,
    });
    recordStructuredObservation({
      eventType: "revenge_trade_guard.evaluated",
      workflow: "sizing",
      source: "agent_tool",
      component: "evaluate_revenge_trade_guard",
      toolName: "evaluate_revenge_trade_guard",
      outcome: "info",
      details: { ...(revengeTradeGuardToPayload(result) as Record<string, unknown>) },
    });
    return {
      sizeMultipleVsBaseline: Number(result.sizeMultipleVsBaseline.toFixed(4)),
      priorTradeWasLoss: result.priorTradeWasLoss,
      sizeAboveThreshold: result.sizeAboveThreshold,
      revengeTradeDetected: result.revengeTradeDetected,
      mode: result.mode,
      recommendedAction: result.recommendedAction,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const revengeTradeGuardTools = {
  evaluate_revenge_trade_guard: revengeTradeGuardDiagnosticTool,
};
