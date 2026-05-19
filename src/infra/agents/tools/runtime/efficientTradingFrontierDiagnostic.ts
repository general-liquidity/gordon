/**
 * Efficient Trading Frontier Diagnostic Tool — Almgren-Chriss
 * cost-vs-timing-risk curve for a fixed order size across execution
 * horizons. Returns the optimal horizon under a given risk aversion.
 *
 * Used pre-trade to answer "how patient should I be on this fill?":
 * - High risk aversion (λ large) → short horizon, accept impact to
 *   minimize price drift exposure.
 * - Low risk aversion (λ small) → long horizon, accept timing risk
 *   to minimize impact.
 *
 * Agent-callable. Not a slash command — the inputs (order size, ADV,
 * vol estimate) are computable by the agent from market data + the
 * pending plan, so the operator doesn't type them directly.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  efficientTradingFrontier,
  efficientTradingFrontierToPayload,
} from "../../../../backtest/analysis/marketImpact.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const efficientTradingFrontierDiagnosticTool = createTool({
  id: "compute_efficient_trading_frontier",
  description:
    "Compute the Almgren-Chriss efficient trading frontier for a fixed order size — sweeps execution horizons and returns expected impact cost, timing risk, and the horizon that minimizes the weighted objective J = impact + λ·timing_risk. " +
    "Use before kicking off a TWAP/VWAP/POV execution when the operator asks 'how patient should I be?' or 'what horizon minimizes total cost for my risk aversion?'.",
  inputSchema: z.object({
    orderSize: z.number().positive().describe("Order size to execute (same units as ADV)."),
    adv: z.number().positive().describe("Average daily volume in the same units."),
    vol: z.number().min(0).describe("Realized intraday volatility as a fraction (e.g. 0.02 = 2% daily)."),
    volAnn: z.number().positive().optional().describe("Annualized volatility. Default = vol * sqrt(daysPerYear)."),
    riskAversion: z
      .number()
      .min(0)
      .optional()
      .describe("λ — weight on timing risk in the objective. Higher λ → prefer shorter horizon. Default 1."),
    horizonDays: z.array(z.number().positive()).optional().describe("Horizon points (days) to evaluate. Default 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10."),
    daysPerYear: z.number().positive().optional().describe("Trading days per year. Default 252."),
  }),
  outputSchema: z.object({
    optimalHorizonDays: z.number(),
    riskAversion: z.number(),
    orderSizeAdvFraction: z.number(),
    pointCount: z.number(),
    points: z.array(
      z.object({
        horizonDays: z.number(),
        participationRate: z.number(),
        expectedImpactBps: z.number(),
        timingRiskBps: z.number(),
        expectedCostBps: z.number(),
        totalObjectiveBps: z.number(),
      }),
    ),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const frontier = efficientTradingFrontier({
      orderSize: input.orderSize,
      adv: input.adv,
      vol: input.vol,
      volAnn: input.volAnn,
      riskAversion: input.riskAversion,
      horizonDays: input.horizonDays,
      daysPerYear: input.daysPerYear,
    });
    const reasoning =
      `Optimal horizon ${frontier.optimalHorizonDays}d at λ=${frontier.riskAversion.toFixed(3)} ` +
      `(orderSize ${(frontier.orderSizeAdvFraction * 100).toFixed(2)}% of ADV across ${frontier.points.length} horizon points).`;
    recordStructuredObservation({
      eventType: "efficient_trading_frontier.requested",
      workflow: "execution_planning",
      source: "agent_tool",
      component: "compute_efficient_trading_frontier",
      toolName: "compute_efficient_trading_frontier",
      outcome: "info",
      details: { ...(efficientTradingFrontierToPayload(frontier) as Record<string, unknown>) },
    });
    return {
      optimalHorizonDays: frontier.optimalHorizonDays,
      riskAversion: frontier.riskAversion,
      orderSizeAdvFraction: Number(frontier.orderSizeAdvFraction.toFixed(6)),
      pointCount: frontier.points.length,
      points: frontier.points.map((p) => ({
        horizonDays: p.horizonDays,
        participationRate: Number(p.participationRate.toFixed(6)),
        expectedImpactBps: Number(p.expectedImpactBps.toFixed(2)),
        timingRiskBps: Number(p.timingRiskBps.toFixed(2)),
        expectedCostBps: Number(p.expectedCostBps.toFixed(2)),
        totalObjectiveBps: Number(p.totalObjectiveBps.toFixed(2)),
      })),
      reasoning,
      summary: reasoning,
    };
  },
});

export const efficientTradingFrontierTools = {
  compute_efficient_trading_frontier: efficientTradingFrontierDiagnosticTool,
};
