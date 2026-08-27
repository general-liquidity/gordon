/**
 * Trade-Consistency Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `computeTradeConsistency` from core/alpha/trade-consistency.ts.
 * Measures Spicy's Stage 3 → Stage 2 gate: are the operator's recent
 * trades actually self-similar enough that the improvement process
 * can isolate variables? Strategy stability + entry-trigger share +
 * stop-CV + target-CV → composite verdict.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeTradeConsistency,
  type TradeExecution,
} from "../../../../core/alpha/trade-consistency.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const tradeConsistencyDiagnosticTool = createTool({
  id: "compute_trade_consistency",
  description:
    "Measure how similar recent trades are to each other across 4 execution dimensions " +
    "(strategy stability, entry-trigger share, stop-distance CV, target-distance CV). " +
    "Composite score → highly_consistent / moderately_consistent / inconsistent / highly_inconsistent. " +
    "Use during retrospective reviews — answers 'am I actually executing the same playbook, or am I " +
    "drifting?'. Stage 3 → Stage 2 gate per Spicy: a strategy must be consistent BEFORE it can be " +
    "made profitable.",
  inputSchema: z.object({
    trades: z
      .array(
        z.object({
          strategyId: z.string().describe("Strategy / playbook label."),
          entryTriggerId: z.string().describe("Entry-trigger label."),
          stopDistance: z
            .number()
            .min(0)
            .describe(
              "Stop distance from entry (R-multiples or %, just be consistent across array).",
            ),
          targetDistance: z
            .number()
            .min(0)
            .describe("Target distance from entry — same convention as stopDistance."),
        }),
      )
      .min(1)
      .describe("Recent trade executions. Default minTrades = 10 before a verdict is emitted."),
    strategyWeight: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Weight for strategy subscore. Default 0.30."),
    entryTriggerWeight: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Weight for entry-trigger subscore. Default 0.25."),
    stopWeight: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Weight for stop-distance subscore. Default 0.225."),
    targetWeight: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Weight for target-distance subscore. Default 0.225."),
    minTrades: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Minimum trades for a verdict. Default 10."),
    cvCeiling: z
      .number()
      .positive()
      .optional()
      .describe("CV at which subscore collapses to 0. Default 1.0."),
  }),
  outputSchema: z.object({
    sampleSize: z.number(),
    strategyMode: z.string().nullable(),
    strategyShare: z.number(),
    entryTriggerMode: z.string().nullable(),
    entryTriggerShare: z.number(),
    stopCv: z.number(),
    targetCv: z.number(),
    subscores: z.object({
      strategy: z.number(),
      entryTrigger: z.number(),
      stopDistance: z.number(),
      targetDistance: z.number(),
    }),
    compositeScore: z.number(),
    verdict: z.enum([
      "highly_consistent",
      "moderately_consistent",
      "inconsistent",
      "highly_inconsistent",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeTradeConsistency(input.trades as TradeExecution[], {
      strategyWeight: input.strategyWeight,
      entryTriggerWeight: input.entryTriggerWeight,
      stopWeight: input.stopWeight,
      targetWeight: input.targetWeight,
      minTrades: input.minTrades,
      cvCeiling: input.cvCeiling,
    });
    recordStructuredObservation({
      eventType: "trade_consistency.computed",
      workflow: "reflection",
      source: "agent_tool",
      component: "compute_trade_consistency",
      toolName: "compute_trade_consistency",
      outcome:
        result.verdict === "highly_inconsistent" || result.verdict === "inconsistent"
          ? "failure"
          : "info",
      details: {
        sampleSize: result.sampleSize,
        verdict: result.verdict,
        compositeScore: result.compositeScore,
        strategyShare: result.strategyShare,
        stopCv: result.stopCv,
        targetCv: result.targetCv,
      },
    });
    return {
      sampleSize: result.sampleSize,
      strategyMode: result.strategyMode,
      strategyShare: result.strategyShare,
      entryTriggerMode: result.entryTriggerMode,
      entryTriggerShare: result.entryTriggerShare,
      stopCv: result.stopCv,
      targetCv: result.targetCv,
      subscores: result.subscores,
      compositeScore: result.compositeScore,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const tradeConsistencyTools = {
  compute_trade_consistency: tradeConsistencyDiagnosticTool,
};
