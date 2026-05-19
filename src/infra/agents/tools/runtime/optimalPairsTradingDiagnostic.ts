/**
 * Optimal Pairs Trading Diagnostic Tool — CJ4 wrapper.
 *
 * Agent-callable. Given OU-spread parameters (θ, μ, σ) from Gordon's
 * cointegration detection plus current spread + inventory, returns the
 * long-horizon stationary optimal trading speed for a pairs trading
 * position. The intended call sequence is: cointegration test → if
 * cointegrated, this tool produces the optimal trading policy.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeOptimalPairsTrading,
  optimalPairsTradingToPayload,
} from "../../../trading/quant/optimalPairsTrading.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const optimalPairsTradingDiagnosticTool = createTool({
  id: "compute_optimal_pairs_trading",
  description:
    "Compute the Cartea-Jaimungal long-horizon stationary optimal trading speed for pairs trading on an OU " +
    "(mean-reverting) spread. Returns ν*(q, X) = −A·q − B·(X − μ), where A handles inventory reversion and B " +
    "handles spread-deviation response. " +
    "Inputs come from Gordon's cointegration test upstream — call this tool after confirming the spread is " +
    "cointegrated, to translate the OU parameters into an actionable trading policy.",
  inputSchema: z.object({
    currentSpread: z.number().describe("Current spread value X_t."),
    equilibriumSpread: z.number().describe("OU equilibrium spread μ (long-run mean)."),
    meanReversionRate: z
      .number()
      .positive()
      .describe("OU mean-reversion rate θ. Faster reversion = larger θ."),
    spreadVolatility: z
      .number()
      .positive()
      .describe("OU volatility σ."),
    currentInventory: z
      .number()
      .describe("Current spread position q (signed; long spread = positive)."),
    impactCoef: z
      .number()
      .positive()
      .describe("Linear-impact coefficient k (>0)."),
    riskAversion: z
      .number()
      .min(0)
      .optional()
      .describe("Running inventory penalty γ. 0 = no risk aversion. Default 0.01."),
  }),
  outputSchema: z.object({
    tradingSpeed: z.number(),
    inventoryCoef: z.number(),
    spreadCoef: z.number(),
    inventoryContribution: z.number(),
    spreadContribution: z.number(),
    inventoryHalfLife: z.number().nullable(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeOptimalPairsTrading({
      currentSpread: input.currentSpread,
      equilibriumSpread: input.equilibriumSpread,
      meanReversionRate: input.meanReversionRate,
      spreadVolatility: input.spreadVolatility,
      currentInventory: input.currentInventory,
      impactCoef: input.impactCoef,
      riskAversion: input.riskAversion,
    });
    recordStructuredObservation({
      eventType: "optimal_pairs_trading.requested",
      workflow: "execution_planning",
      source: "agent_tool",
      component: "compute_optimal_pairs_trading",
      toolName: "compute_optimal_pairs_trading",
      outcome: "info",
      details: { ...(optimalPairsTradingToPayload(result) as Record<string, unknown>) },
    });
    return {
      tradingSpeed: Number(result.tradingSpeed.toFixed(6)),
      inventoryCoef: Number(result.inventoryCoef.toFixed(6)),
      spreadCoef: Number(result.spreadCoef.toFixed(6)),
      inventoryContribution: Number(result.inventoryContribution.toFixed(6)),
      spreadContribution: Number(result.spreadContribution.toFixed(6)),
      inventoryHalfLife: Number.isFinite(result.inventoryHalfLife)
        ? Number(result.inventoryHalfLife.toFixed(4))
        : null,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const optimalPairsTradingTools = {
  compute_optimal_pairs_trading: optimalPairsTradingDiagnosticTool,
};
