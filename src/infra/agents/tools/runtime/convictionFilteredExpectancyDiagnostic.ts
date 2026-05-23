/**
 * Conviction-Filtered Expectancy Diagnostic Tool — agent-callable
 * wrapper.
 *
 * Wraps `simulateConvictionFilteredExpectancy` from
 * core/alpha/conviction-filtered-expectancy.ts. Operationalizes the
 * "hidden edge buried in noise" pattern: given a trade ledger + a
 * continuous conviction/quality score, find the threshold that
 * maximizes expectancy and report the hypothetical PnL had the
 * operator only taken trades above that threshold.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { simulateConvictionFilteredExpectancy } from "../../../../core/alpha/conviction-filtered-expectancy.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const convictionFilteredExpectancyDiagnosticTool = createTool({
  id: "simulate_conviction_filtered_expectancy",
  description:
    "Find the optimal conviction threshold for filtering a trade ledger. Operator supplies trades with " +
    "(conviction, pnl). Returns the threshold that maximizes the chosen objective (total_pnl, avg_pnl, " +
    "sharpe, or pnl_per_hour) + a comparison vs the keep-all baseline. Answers 'had I only taken my " +
    "top-X by conviction, what would my PnL have been?'. Distinct from expectancy-by-tag (categorical " +
    "tags) and constraint-identifier (EV-component decomposition).",
  inputSchema: z.object({
    trades: z
      .array(
        z.object({
          tradeId: z.string(),
          conviction: z.number(),
          pnl: z.number(),
        }),
      )
      .min(1)
      .describe("Per-trade records with conviction score + realized PnL."),
    objective: z
      .enum(["total_pnl", "avg_pnl", "sharpe", "pnl_per_hour"])
      .optional()
      .describe("Optimization objective. Default 'total_pnl'."),
    minKeptTrades: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Min trades that must remain after filtering. Default 10."),
    timePerTrade: z
      .number()
      .positive()
      .optional()
      .describe("Time per trade for 'pnl_per_hour' objective."),
    thresholdResolution: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Number of thresholds to evaluate. Default 200."),
  }),
  outputSchema: z.object({
    totalTrades: z.number(),
    baselineMetrics: z.object({
      threshold: z.number(),
      keptCount: z.number(),
      keptFraction: z.number(),
      totalPnl: z.number(),
      avgPnl: z.number(),
      hitRate: z.number(),
      stdPnl: z.number(),
      sharpeRatio: z.number(),
      pnlPerHour: z.number().nullable(),
      objectiveValue: z.number(),
    }),
    optimalThreshold: z
      .object({
        threshold: z.number(),
        keptCount: z.number(),
        keptFraction: z.number(),
        totalPnl: z.number(),
        avgPnl: z.number(),
        hitRate: z.number(),
        stdPnl: z.number(),
        sharpeRatio: z.number(),
        pnlPerHour: z.number().nullable(),
        objectiveValue: z.number(),
      })
      .nullable(),
    improvementOverBaseline: z.number(),
    optimalKeptFraction: z.number(),
    verdict: z.enum([
      "filtered_edge_found",
      "no_edge_at_any_threshold",
      "baseline_already_optimal",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = simulateConvictionFilteredExpectancy(input.trades, {
      objective: input.objective,
      minKeptTrades: input.minKeptTrades,
      timePerTrade: input.timePerTrade,
      thresholdResolution: input.thresholdResolution,
    });
    recordStructuredObservation({
      eventType: "conviction_filtered_expectancy.simulated",
      workflow: "audit",
      source: "agent_tool",
      component: "simulate_conviction_filtered_expectancy",
      toolName: "simulate_conviction_filtered_expectancy",
      outcome:
        result.verdict === "filtered_edge_found" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        totalTrades: result.totalTrades,
        improvement: result.improvementOverBaseline,
        optimalKeptFraction: result.optimalKeptFraction,
      },
    });
    return {
      totalTrades: result.totalTrades,
      baselineMetrics: result.baselineMetrics,
      optimalThreshold: result.optimalThreshold,
      improvementOverBaseline: result.improvementOverBaseline,
      optimalKeptFraction: result.optimalKeptFraction,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const convictionFilteredExpectancyTools = {
  simulate_conviction_filtered_expectancy:
    convictionFilteredExpectancyDiagnosticTool,
};
