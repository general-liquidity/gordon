/**
 * Aggression Ratio Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `computeAggressionRatio` from core/alpha/aggression-ratio.ts.
 * EMA ratio of taker-buy to taker-sell volume from exchange APIs.
 * Scott (HyperTrend) cites this as a publicly-known sharp-2.5 signal
 * in crypto. Distinct from orderflowDelta.ts (estimates from OHLCV;
 * this uses actual taker volume) and order-book-imbalance.ts (static
 * book state; this is flow over time).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { computeAggressionRatio } from "../../../../core/alpha/aggression-ratio.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const aggressionRatioDiagnosticTool = createTool({
  id: "compute_aggression_ratio",
  description:
    "EMA ratio of taker-buy to taker-sell volume across recent bars. Operator supplies actual per-bar " +
    "taker_buy_volume + taker_sell_volume (Binance kline endpoint, Coinbase advanced trades, Bybit " +
    "linear, etc. all report this). Returns directional verdict (strong_buy / buy / neutral / sell / " +
    "strong_sell). Scott explicitly names this as sharp-2.5 in crypto. Distinct from orderflowDelta " +
    "(OHLCV estimation) and order-book-imbalance (static book state).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          takerBuyVolume: z.number(),
          takerSellVolume: z.number(),
        }),
      )
      .min(2)
      .describe("Per-bar taker volume split. Order oldest → newest."),
    lookback: z.number().int().min(2).optional().describe("EMA lookback. Default 20."),
    minBars: z.number().int().min(2).optional().describe("Min bars for verdict. Default 10."),
    strongBuyThreshold: z
      .number()
      .optional()
      .describe("Log-ratio threshold for strong_buy. Default 0.30."),
    buyThreshold: z.number().optional().describe("Log-ratio threshold for buy. Default 0.10."),
    sellThreshold: z
      .number()
      .optional()
      .describe("Log-ratio threshold for sell. Default -buyThreshold."),
    strongSellThreshold: z
      .number()
      .optional()
      .describe("Log-ratio threshold for strong_sell. Default -strongBuyThreshold."),
  }),
  outputSchema: z.object({
    sampleSize: z.number(),
    emaBuyVolume: z.number(),
    emaSellVolume: z.number(),
    ratio: z.number(),
    logRatio: z.number(),
    verdict: z.enum(["strong_buy", "buy", "neutral", "sell", "strong_sell", "insufficient_data"]),
    directionalBias: z.enum(["long", "short"]).nullable(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeAggressionRatio(input.bars, {
      lookback: input.lookback,
      minBars: input.minBars,
      strongBuyThreshold: input.strongBuyThreshold,
      buyThreshold: input.buyThreshold,
      sellThreshold: input.sellThreshold,
      strongSellThreshold: input.strongSellThreshold,
    });
    recordStructuredObservation({
      eventType: "aggression_ratio.computed",
      workflow: "analysis",
      source: "agent_tool",
      component: "compute_aggression_ratio",
      toolName: "compute_aggression_ratio",
      outcome: "info",
      details: {
        verdict: result.verdict,
        ratio: result.ratio,
        logRatio: result.logRatio,
        bias: result.directionalBias,
      },
    });
    return result;
  },
});

export const aggressionRatioTools = {
  compute_aggression_ratio: aggressionRatioDiagnosticTool,
};
