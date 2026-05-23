/**
 * SMT Divergence Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeSmtDivergence` from core/alpha/smt-divergence.ts.
 * Multi-asset level-anchored cross-sectional sweep test. Detects the
 * "one asset sweeps while N-1 refuse" pattern — distinct from the
 * single-asset detectLiquiditySweeps in smc-patterns.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeSmtDivergence } from "../../../../core/alpha/smt-divergence.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const smtDivergenceDiagnosticTool = createTool({
  id: "analyze_smt_divergence",
  description:
    "Cross-sectional sweep test across N correlated assets at a key level. Caller supplies per-asset " +
    "windowHigh, windowLow, referenceLevel, and ADR. Returns confirmed_sweep (all assets crossed → " +
    "continuation), divergent_sweep (exactly one crossed, others refused → manipulation/reversal " +
    "signature), partial_confirmation (in between), or no_sweep. Distinct from the single-asset " +
    "liquidity-sweep detector — this is the cross-asset 'SMT' check. Honest scope: detects the " +
    "geometric pattern; marketed win-rate claims are unverifiable single-source data.",
  inputSchema: z.object({
    assets: z
      .array(
        z.object({
          symbol: z.string(),
          windowHigh: z.number(),
          windowLow: z.number(),
          referenceLevel: z.number(),
          adr: z.number().positive(),
        }),
      )
      .min(2)
      .describe("Per-asset OHLC window summary + reference level + ADR."),
    direction: z
      .enum(["up", "down"])
      .describe("Sweep direction. 'up' = test crossings ABOVE reference; 'down' = below."),
    minSweepFraction: z
      .number()
      .min(0)
      .optional()
      .describe("Min sweep size as fraction of ADR. Default 0.05."),
    maxSweepFraction: z
      .number()
      .positive()
      .optional()
      .describe("Max sweep size before treated as breakout. Default 1.5."),
  }),
  outputSchema: z.object({
    direction: z.enum(["up", "down"]),
    sweptCount: z.number(),
    refusedCount: z.number(),
    totalAssets: z.number(),
    isolatedSweeper: z.string().nullable(),
    reversalDirection: z.enum(["long", "short"]).nullable(),
    verdict: z.enum([
      "confirmed_sweep",
      "divergent_sweep",
      "partial_confirmation",
      "no_sweep",
      "insufficient_data",
    ]),
    assetStatuses: z.array(
      z.object({
        symbol: z.string(),
        sweepFractionOfAdr: z.number(),
        swept: z.boolean(),
        refused: z.boolean(),
      }),
    ),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeSmtDivergence(input.assets, {
      direction: input.direction,
      minSweepFraction: input.minSweepFraction,
      maxSweepFraction: input.maxSweepFraction,
    });
    recordStructuredObservation({
      eventType: "smt_divergence.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_smt_divergence",
      toolName: "analyze_smt_divergence",
      outcome: result.verdict === "divergent_sweep" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        direction: result.direction,
        sweptCount: result.sweptCount,
        refusedCount: result.refusedCount,
        isolatedSweeper: result.isolatedSweeper,
      },
    });
    return result;
  },
});

export const smtDivergenceTools = {
  analyze_smt_divergence: smtDivergenceDiagnosticTool,
};
