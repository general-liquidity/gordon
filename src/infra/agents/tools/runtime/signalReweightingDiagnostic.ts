/**
 * Signal Reweighting Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `reweightSignals` from core/alpha/signal-recency-reweighting.ts.
 * Scott (HyperTrend) cites: "the correlation of the last 6 months'
 * returns accounts for 13% of next month's signal performance." So
 * you can SLIGHTLY upweight signals that have done well recently and
 * downweight ones that haven't. Default strength = 0.13 matches his
 * reported correlation.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { reweightSignals } from "../../../../core/alpha/signal-recency-reweighting.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const signalReweightingDiagnosticTool = createTool({
  id: "reweight_signals_by_recency",
  description:
    "Forward-looking signal-portfolio weight selection based on recent performance. Caller supplies " +
    "N signals + each signal's recent-period returns. Returns per-signal weight that slightly " +
    "upweights recent winners + downweights recent losers. Default strength=0.13 matches Scott's " +
    "reported 6-month → 1-month signal-performance correlation. Distinct from expectancy-by-tag " +
    "(backward decomposition), composite-attribution (verdict-to-input), walk-forward-ic (IC " +
    "tracking) — this is forward weight selection at the SIGNAL portfolio level.",
  inputSchema: z.object({
    signals: z
      .array(
        z.object({
          signalId: z.string(),
          recentReturns: z.array(z.number()),
        }),
      )
      .min(1)
      .describe("Signal performance histories. Each recentReturns oldest → newest."),
    metric: z
      .enum(["mean", "sharpe", "hit_rate"])
      .optional()
      .describe("Performance metric to rank on. Default 'mean'."),
    annualizationFactor: z
      .number()
      .positive()
      .optional()
      .describe("Annualization for sharpe metric. Default 1."),
    strength: z
      .number()
      .min(0)
      .optional()
      .describe("Reweighting strength. Default 0.13 (Scott's reported correlation)."),
    minWeight: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Per-signal weight floor. Default 0.02."),
    maxWeight: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Per-signal weight ceiling. Default 0.50."),
    minPeriodsPerSignal: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Min recent-return periods required per signal. Default 5."),
  }),
  outputSchema: z.object({
    signalCount: z.number(),
    validSignalCount: z.number(),
    metric: z.enum(["mean", "sharpe", "hit_rate"]),
    weights: z.array(
      z.object({
        signalId: z.string(),
        recentMetric: z.number(),
        zScore: z.number(),
        weight: z.number(),
        relativeToEqualWeight: z.number(),
      }),
    ),
    verdict: z.enum(["reweighted", "equal_weighted_fallback", "insufficient_data"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = reweightSignals(input.signals, {
      metric: input.metric,
      annualizationFactor: input.annualizationFactor,
      strength: input.strength,
      minWeight: input.minWeight,
      maxWeight: input.maxWeight,
      minPeriodsPerSignal: input.minPeriodsPerSignal,
    });
    recordStructuredObservation({
      eventType: "signal_reweighting.computed",
      workflow: "portfolio_construction",
      source: "agent_tool",
      component: "reweight_signals_by_recency",
      toolName: "reweight_signals_by_recency",
      outcome: result.verdict === "equal_weighted_fallback" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        signalCount: result.signalCount,
        validSignalCount: result.validSignalCount,
        metric: result.metric,
      },
    });
    return result;
  },
});

export const signalReweightingTools = {
  reweight_signals_by_recency: signalReweightingDiagnosticTool,
};
